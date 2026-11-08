"use client";
/**
 * Procesador del Bridge en segundo plano. Antes todo esto vivía en la página
 * del Bridge: si nadie la tenía abierta, los pedidos de Uber, DiDi y Rappi se
 * quedaban en la nube sin venta, sin inventario y sin tickets por estación.
 * Ahora corre en el equipo principal estando en cualquier pantalla de B-POS
 * (y en la página del Bridge, como respaldo). Por cada pedido:
 *   1. Interpretar con las equivalencias (/api/bridge/interpret).
 *   2. Tickets por estación en cuanto todo tiene equivalencia (si falta algo,
 *      el pedido se detiene y se le avisa al Agent para que no saque el original).
 *   3. Validar y armar la venta (/api/bridge/validate).
 *   4. Crear la venta (descuenta inventario como una venta normal) y finalizar.
 * Antes de tocar un pedido se aparta en la nube para este equipo: dos
 * pantallas nunca crean la misma venta ni imprimen dos veces.
 */
import { notify } from "@/components/layout/Dialogs";
import { getAdminIngredients, getAdminProducts, getAdminRecipes } from "@/lib/admin";
import { addAuditEvent } from "@/lib/audit";
import { bridgeFetch } from "@/lib/bridge/bridge-fetch";
import { createAutomaticSale } from "@/lib/bridge/create-automatic-sale";
import { buildDeliveryTicket } from "@/lib/bridge/delivery-ticket";
import type { OrderInterpretation } from "@/lib/bridge/interpret-order";
import { buildOrderTickets } from "@/lib/bridge/order-tickets";
import type { SaleReadyPayload } from "@/lib/bridge/prepare-sale";
import { stationsByLine } from "@/lib/bridge/station-routing";
import type { FinalOrderValidation } from "@/lib/bridge/validate-order";
import { getBusinessSettings } from "@/lib/business-settings";
import { printDeliveryTickets } from "@/lib/localService";

export type ProcessorOrder = {
  platform?: string;
  orderId?: string | null;
  receivedAt?: string;
  bridgeReceivedAt?: string;
  customer?: { name?: string | null; phone?: string | null };
  delivery?: { address?: string | null; type?: string | null };
  rawText?: string;
  total?: number;
  status?: string;
  interpretation?: OrderInterpretation;
  validation?: FinalOrderValidation;
  readyForSale?: boolean;
  saleReadyPayload?: SaleReadyPayload | null;
  createdOrderId?: number;
  stationPrint?: unknown;
};

// Pedidos más viejos no se mandan a estaciones (ej. al prender la caja horas después)
export const STATION_PRINT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const normalize = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const keyOf = (order: ProcessorOrder) => `${normalize(order.platform)}:${order.orderId}`;

/** Sin la fecha de cuándo se calculó: para saber si de verdad cambió algo */
const core = (value: object | null | undefined, stamp: string) => (value ? JSON.stringify({ ...value, [stamp]: undefined }) : "");

const randomId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Quién aparta los pedidos: este equipo (el de la sincronización) y esta
 * pestaña. Dos pestañas abiertas en la caja (POS y Bridge) también se turnan.
 */
function claimId() {
  try {
    let device = localStorage.getItem("bpos_device_id");
    if (!device) {
      device = `dev-${randomId()}`;
      localStorage.setItem("bpos_device_id", device);
    }
    let tab = sessionStorage.getItem("bpos_bridge_tab");
    if (!tab) {
      tab = randomId();
      sessionStorage.setItem("bpos_bridge_tab", tab);
    }
    return `${device}:${tab}`;
  } catch {
    return `sin-almacenamiento:${randomId()}`;
  }
}

// Memoria del procesador mientras la pestaña está abierta
const busy = new Set<string>();
/** Pedidos detenidos a los que ya se les canceló el respaldo del Agent */
const holdNotified = new Set<string>();
/** Intentos fallidos de tickets por pedido (si ninguna impresora aceptó, hasta 3) */
const printFailures = new Map<string, number>();
/** Qué se interpretó/validó por última vez con qué datos (para no repetir llamadas) */
const lastInterpret = new Map<string, string>();
const lastValidate = new Map<string, string>();

async function patchOrder(order: ProcessorOrder, changes: Record<string, unknown>) {
  const response = await bridgeFetch("/api/bridge/orders", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform: order.platform, orderId: order.orderId, ...changes }),
  });
  const payload = (await response.json().catch(() => ({}))) as { success?: boolean; order?: ProcessorOrder; error?: string };
  if (!response.ok || !payload.success) throw new Error(payload.error || "No se pudo guardar el pedido.");
  return payload.order ? { ...order, ...payload.order } : order;
}

async function claim(order: ProcessorOrder) {
  const response = await bridgeFetch("/api/bridge/orders", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform: order.platform, orderId: order.orderId, claim: claimId() }),
  });
  const payload = (await response.json().catch(() => ({}))) as { claimed?: boolean };
  return response.ok && payload.claimed === true;
}

type Catalog = {
  products: ReturnType<typeof getAdminProducts>;
  ingredients: ReturnType<typeof getAdminIngredients>;
  signature: string;
};

function readCatalog(): Catalog {
  const products = getAdminProducts();
  const ingredients = getAdminIngredients();
  const signature = JSON.stringify({
    p: products.map((p) => [p.id, p.name, Boolean(p.modifierGroups?.length)]),
    i: ingredients.map((i) => [i.id, i.name, i.unit]),
  });
  return { products, ingredients, signature };
}

const finished = (order: ProcessorOrder) => order.status === "Finalizado" || order.status === "Venta creada" || Boolean(order.createdOrderId);
const isOld = (order: ProcessorOrder) => {
  const received = Date.parse(order.bridgeReceivedAt || order.receivedAt || "");
  return Number.isFinite(received) && Date.now() - received > STATION_PRINT_MAX_AGE_MS;
};

/** ¿Este pedido tiene algo pendiente que el procesador pueda hacer ahora? */
function needsWork(order: ProcessorOrder, aliasSignature: string, catalog: Catalog) {
  if (!order.platform || !order.orderId) return false;
  const key = keyOf(order);
  if (!finished(order)) {
    if (lastInterpret.get(key) !== `${aliasSignature}|${catalog.signature}|${order.rawText || ""}`) return true;
    if (order.interpretation && lastValidate.get(key) !== `${core(order.interpretation, "interpretedAt")}|${catalog.signature}`) return true;
    if (order.readyForSale && order.saleReadyPayload) return true;
  }
  const blocked = Boolean(order.interpretation && (order.interpretation.pendingCount > 0 || order.interpretation.errorCount > 0));
  if (!order.stationPrint && order.interpretation && !isOld(order) && (!blocked || !holdNotified.has(key))) return true;
  return false;
}

/**
 * Una vuelta: revisa cada pedido y avanza lo que se pueda. Devuelve true si
 * cambió algo en la nube (para volver a revisar pronto).
 */
export async function processBridgeOrders(orders: ProcessorOrder[], aliases: unknown[], aliasSignature: string): Promise<boolean> {
  const catalog = readCatalog();
  let changed = false;
  for (const original of orders) {
    if (!needsWork(original, aliasSignature, catalog)) continue;
    const key = keyOf(original);
    if (busy.has(key)) continue;
    busy.add(key);
    try {
      if (!(await claim(original))) continue;
      let order = original;

      // 1. Interpretar con las equivalencias de hoy
      const interpretKey = `${aliasSignature}|${catalog.signature}|${order.rawText || ""}`;
      if (!finished(order) && lastInterpret.get(key) !== interpretKey) {
        const response = await bridgeFetch("/api/bridge/interpret", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platform: order.platform, rawText: order.rawText || "", aliases, products: catalog.products, ingredients: catalog.ingredients }),
        });
        const payload = (await response.json().catch(() => ({}))) as { success?: boolean; interpretation?: OrderInterpretation; error?: string };
        if (!response.ok || !payload.success || !payload.interpretation) throw new Error(payload.error || "No se pudo interpretar el pedido.");
        if (core(order.interpretation, "interpretedAt") !== core(payload.interpretation, "interpretedAt")) {
          order = await patchOrder(order, { interpretation: payload.interpretation });
          changed = true;
        }
        lastInterpret.set(key, interpretKey);
      }

      // 2. Tickets por estación (o detenerlo si falta equivaler algo)
      if (!order.stationPrint && order.interpretation && !isOld(order)) {
        if (order.interpretation.pendingCount > 0 || order.interpretation.errorCount > 0) {
          if (!holdNotified.has(key)) {
            holdNotified.add(key);
            // Pedir tickets vacíos le quita al Agent el respaldo de sacar el original en Cocina
            printDeliveryTickets({ platform: order.platform!, orderId: order.orderId!, tickets: [] }).catch((error) => {
              holdNotified.delete(key);
              console.error(`No se pudo detener ${key} en el Agent:`, error);
            });
          }
        } else {
          try {
            const { tickets } = await buildOrderTickets(order, { products: catalog.products, recipes: getAdminRecipes() }, getBusinessSettings());
            let result = await printDeliveryTickets({ platform: order.platform!, orderId: order.orderId!, tickets });
            // El Agent ya sacó algo de este pedido (el original de respaldo, o el mismo número de otro día):
            // las estaciones y la bolsa todavía no tienen su ticket, así que se mandan de todos modos
            if (result.alreadyPrinted && !result.results?.length) result = await printDeliveryTickets({ platform: order.platform!, orderId: order.orderId!, tickets, force: true });
            const printers = (result.results || []).filter((r) => r.ok && r.printer).map((r) => r.printer as string);
            const failures = (result.results || []).filter((r) => !r.ok);
            let give = true;
            if (printers.length === 0 && failures.length) {
              // Nada salió (impresora apagada, cola trabada): se reintenta en la siguiente vuelta, hasta 3
              const tries = (printFailures.get(key) || 0) + 1;
              printFailures.set(key, tries);
              const detail = failures.map((r) => `${r.target}: ${r.error || "sin detalle"}`).join(" · ");
              console.error(`Ningún ticket de ${key} salió (intento ${tries}): ${detail}`);
              if (tries < 3) give = false;
              else notify(`No se pudieron imprimir los tickets del pedido ${order.orderId} tras 3 intentos (${detail}). Revisa la impresora y usa Reimprimir en Impresiones.`, "error");
            }
            if (give) {
              order = await patchOrder(order, { stationPrint: { at: new Date().toISOString(), stations: tickets.map((t) => t.target), printers } });
              changed = true;
            }
          } catch (error) {
            // Sin Agent conectado: el Agent imprime el original en Cocina por su cuenta cuando vuelva
            console.error(`No se pudo mandar ${key} a las estaciones:`, error);
          }
        }
      }

      // 3. Validar y armar la venta
      const validateKey = `${core(order.interpretation, "interpretedAt")}|${catalog.signature}`;
      if (!finished(order) && order.interpretation && lastValidate.get(key) !== validateKey) {
        const response = await bridgeFetch("/api/bridge/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platform: order.platform,
            orderId: order.orderId,
            customer: order.customer,
            delivery: order.delivery,
            total: order.total,
            rawText: order.rawText || "",
            interpretation: order.interpretation,
            products: catalog.products,
            ingredients: catalog.ingredients,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as { success?: boolean; validation?: FinalOrderValidation; saleReadyPayload?: SaleReadyPayload | null; error?: string };
        if (!response.ok || !payload.success || !payload.validation) throw new Error(payload.error || "No se pudo validar el pedido.");
        const before = JSON.stringify({ v: core(order.validation, "checkedAt"), s: core(order.saleReadyPayload, "preparedAt") });
        const after = JSON.stringify({ v: core(payload.validation, "checkedAt"), s: core(payload.saleReadyPayload, "preparedAt") });
        if (before !== after) {
          order = await patchOrder(order, { validation: payload.validation, saleReadyPayload: payload.saleReadyPayload ?? null });
          changed = true;
        }
        lastValidate.set(key, validateKey);
      }

      // 4. Crear la venta (descuenta inventario) y finalizar
      if (!finished(order) && order.readyForSale && order.saleReadyPayload) {
        const result = createAutomaticSale(order.saleReadyPayload, {
          receivedAt: order.bridgeReceivedAt || order.receivedAt,
          // Para reimprimir desde Impresiones con los mismos renglones del pedido
          ticket: buildDeliveryTicket(order, stationsByLine(order.interpretation, catalog.products, getAdminRecipes())),
        });
        if (!result.success) {
          console.error(`No se pudo crear la venta automática ${order.saleReadyPayload.externalOrderKey}:`, result.error);
          continue;
        }
        if (!result.duplicate) {
          const sale = result.order;
          addAuditEvent({
            category: "Venta",
            action: "delivery.received",
            description: `Pedido ${sale.externalPlatform} ${sale.externalOrderNumber} por $${sale.total.toFixed(2)} (${sale.items.reduce((n, i) => n + i.quantity, 0)} productos)`,
            entityId: String(sale.id),
            metadata: { platform: sale.externalPlatform, orderNumber: sale.externalOrderNumber, total: sale.total },
          });
        }
        order = await patchOrder(order, { status: "Finalizado", createdOrderId: result.orderId });
        changed = true;
      }
    } catch (error) {
      console.error(`Bridge en segundo plano (${key}):`, error);
    } finally {
      busy.delete(key);
    }
  }
  return changed;
}
