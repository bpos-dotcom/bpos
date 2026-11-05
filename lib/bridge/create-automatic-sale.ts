"use client";

import { getAdminProducts } from "@/lib/admin";
import type { DeliveryTicket } from "@/lib/bridge/delivery-ticket";
import type { SaleReadyPayload } from "@/lib/bridge/prepare-sale";
import { applyInventoryForOrder, correctInventoryForOrder } from "@/lib/inventory";
import { createKdsCriticalError, notifyKdsUpdated } from "@/lib/kds";
import type { KdsTicketLine } from "@/lib/bridge/ticket-structure";
import { allocateShiftOrderNumber } from "@/lib/order-sequence";
import { OWN_OPTIONS, buildSelection, isAutoGroup, optionName, type SoldModifier, type SoldPart } from "@/lib/compound";
import type { Product } from "@/data/products";

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

type PreparedLine = { sourceIndex?: number; externalName?: string; compound?: boolean };

/**
 * ¿Este renglón se arma como combo (leer sub-líneas, partes por estación,
 * receta de cada opción)? Solo si la equivalencia se marcó compuesta. Un
 * pedido preparado antes de que existiera la casilla conserva el
 * comportamiento viejo: combo si el producto tiene grupos de opciones.
 */
function isCompoundLine(product: Product, line: PreparedLine) {
  if (!product.modifierGroups?.length) return false;
  return line.compound === undefined ? true : line.compound;
}

/**
 * Renglón del ticket al que corresponde el producto: por número de renglón,
 * si no por nombre. Sin renglón propio se leen las opciones de todo el ticket
 * (pedidos viejos preparados antes de guardar el renglón).
 */
function ownTicketItems(ticket: DeliveryTicket | undefined, line: PreparedLine) {
  const items = ticket?.items || [];
  const byIndex = items.find((i) => i.index === line.sourceIndex);
  if (byIndex) return [byIndex];
  const name = plain(line.externalName || "");
  const byName = name ? items.filter((i) => plain(i.name) === name) : [];
  return byName.length ? byName : items;
}

/**
 * Opciones de un combo de delivery: lo que el cliente eligió en la
 * plataforma ("Elige tu refresco: Manzanita") decide la opción. Si el
 * ticket no dice nada de un grupo, el grupo queda vacío: no se inventa
 * la primera opción (salía "Papas Fritas" fantasma en una hamburguesa
 * sola). Solo cuentan las sub-líneas del renglón de este combo: dos
 * combos con hamburguesas distintas en el mismo pedido no se cruzan.
 */
function deliveryPicks(product: Product, catalog: Product[], ticket: DeliveryTicket | undefined, line: PreparedLine) {
  const said = ownTicketItems(ticket, line).flatMap((i) => [...i.choices.map((c) => c.name), ...i.notes]).map(plain).filter(Boolean);
  const picks: Record<string, string[]> = {};
  for (const group of product.modifierGroups || []) {
    if (isAutoGroup(group)) continue; // ya se llena solo
    const matched = group.options
      .filter((o) => {
        const name = plain(optionName(o, catalog));
        return name && said.some((s) => s.includes(name) || name.includes(s));
      })
      .map((o) => o.key);
    const limit = group.max > 0 ? group.max : matched.length;
    if (matched.length) picks[group.key] = matched.slice(0, limit);
  }
  return picks;
}

function deliverySelection(product: Product, catalog: Product[], ticket: DeliveryTicket | undefined, line: PreparedLine) {
  const { parts, modifiers, ownTicket } = buildSelection(product, catalog, { [OWN_OPTIONS]: deliveryPicks(product, catalog, ticket, line) });
  // El cobro de extras ya viene en el total de la plataforma
  const kept = modifiers?.filter((m) => !m.extra);
  return { ...(parts?.length ? { parts, ownTicket } : {}), ...(kept?.length ? { modifiers: kept } : {}) };
}

const ORDERS_KEY = "bpos_orders";
const SHIFT_KEY = "bpos_active_shift";

export type AutomaticSaleResult =
  | {
      success: true;
      duplicate: false;
      orderId: number;
      order: AutomaticSaleOrder;
    }
  | {
      success: true;
      duplicate: true;
      orderId: number;
      order: AutomaticSaleOrder;
    }
  | {
      success: false;
      duplicate: false;
      error: string;
    };

type AutomaticSaleItem = {
  id: number;
  name: string;
  category: string;
  price: number;
  emoji?: string;
  station?: "Parrilla" | "Freidora" | "Barra" | "Cocina";
  quantity: number;
  externalName?: string;
  parts?: SoldPart[];
  modifiers?: SoldModifier[];
  ownTicket?: boolean;
};

export type AutomaticSaleOrder = {
  id: number;
  localOrderNumber: number;
  shiftSessionId: string;
  createdAt: string;
  items: AutomaticSaleItem[];
  details: {
    orderType: string;
    customerName: string;
    customerPhone: string;
    customerAddress: string;
    paymentMethod: string;
    discount: number;
  };
  subtotal: number;
  total: number;
  source: "B-POS Bridge";
  externalOrderNumber: string;
  externalOrderKey: string;
  externalPlatform: string;
  externalTotal: number;
  externalRawText: string;
  kdsTicketLines: KdsTicketLine[];
  bridgeActions: {
    inventoryAdjustments: SaleReadyPayload["inventoryAdjustments"];
    ignoredLines: SaleReadyPayload["ignoredLines"];
  };
  status: "Nuevo" | "Entregado"; // "Entregado" si se equivaló tarde (cocina ya lo preparó)
  kdsReleased: true;
  kdsReleasedAt: string;
  kdsCompleted: boolean;
  kdsCompletedAt?: string;
  /** Ticket armado por el Bridge con los renglones del pedido original (para reimprimir igual) */
  deliveryTicket?: DeliveryTicket;
};

function readOrders(): AutomaticSaleOrder[] {
  try {
    const raw = localStorage.getItem(ORDERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function platformLabel(platform: string) {
  const value = platform.toLowerCase();
  if (value.includes("didi")) return "Didi Food";
  if (value.includes("uber")) return "Uber Eats";
  if (value.includes("rappi")) return "Rappi";
  return "Plataforma";
}

function nextOrderId(orders: AutomaticSaleOrder[]) {
  return orders.reduce((max, order) => Math.max(max, Number(order.id) || 0), 0) + 1;
}

/** Si se equivale después de esto, cocina ya lo preparó con el ticket impreso: entra al KDS como entregado. */
const LATE_SALE_MS = 15 * 60 * 1000;
/**
 * DiDi reinicia sus números cada día (#1, #2…): el mismo número solo es el
 * mismo pedido si llegó hace menos de esto. Antes el DiDi #12 de hoy se tomaba
 * como repetido del #12 de ayer y no se creaba la venta.
 */
export const SAME_ORDER_WINDOW_MS = 12 * 60 * 60 * 1000;

/** Productos de la venta a partir del pedido preparado (con las equivalencias de ese momento) */
function buildSaleItems(payload: SaleReadyPayload, ticket: DeliveryTicket | undefined): { items: AutomaticSaleItem[] } | { error: string } {
  const catalog = getAdminProducts();
  const items: AutomaticSaleItem[] = [];
  for (const preparedProduct of payload.products) {
    const product = catalog.find((candidate) => String(candidate.id) === String(preparedProduct.productId));
    if (!product) return { error: `El producto ${preparedProduct.productId} ya no existe en el catálogo.` };
    const quantity = Number(preparedProduct.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return { error: `Cantidad inválida para ${product.name}.` };
    items.push({
      ...product,
      // Un producto que no se vende por separado es un modificador de la plataforma: su precio ya va en el renglón principal
      ...(product.notSoldAlone ? { price: 0 } : {}),
      quantity,
      externalName: preparedProduct.externalName,
      // Equivalencia compuesta: cada opción elegida va a su estación y descuenta
      // su receta. Sin ella, el producto se descuenta con su receta tal cual.
      ...(isCompoundLine(product, preparedProduct) ? deliverySelection(product, catalog, ticket, preparedProduct) : {}),
    });
  }
  if (items.length === 0) return { error: "El pedido no contiene productos vendibles." };
  return { items };
}

/**
 * Pedido finalizado mal equivalado: rehace los productos de la venta con las
 * equivalencias de hoy y corrige el inventario (regresa lo descontado y
 * descuenta lo nuevo, anotado en la bitácora de inventario). El folio, la hora
 * y el turno no cambian; el total se recalcula con los precios del catálogo,
 * igual que al crear la venta.
 */
export function correctAutomaticSale(saleId: number, payload: SaleReadyPayload, options: { ticket?: DeliveryTicket; by: string }) {
  const orders = readOrders();
  const sale = orders.find((o) => Number(o.id) === Number(saleId));
  if (!sale) return { success: false as const, error: "No encontré la venta de este pedido en este dispositivo." };
  const built = buildSaleItems(payload, options.ticket);
  if ("error" in built) return { success: false as const, error: built.error };
  const subtotal = built.items.reduce((sum, item) => sum + Number(item.price || 0) * item.quantity, 0);
  const updated: AutomaticSaleOrder = {
    ...sale,
    items: built.items,
    subtotal,
    total: Math.max(0, subtotal - Number(sale.details?.discount || 0)),
    bridgeActions: { inventoryAdjustments: payload.inventoryAdjustments, ignoredLines: payload.ignoredLines },
    ...(options.ticket ? { deliveryTicket: options.ticket } : {}),
  };
  const before = sale.items.map((i) => `${i.quantity}x ${i.name}`).join(", ");
  const after = updated.items.map((i) => `${i.quantity}x ${i.name}`).join(", ");
  try {
    correctInventoryForOrder(updated, `equivalencia corregida por ${options.by}`);
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "No se pudo corregir el inventario." };
  }
  localStorage.setItem(ORDERS_KEY, JSON.stringify(orders.map((o) => (Number(o.id) === Number(saleId) ? updated : o))));
  window.dispatchEvent(new CustomEvent("bpos:orders-updated", { detail: { orderId: sale.id, source: "bridge" } }));
  return { success: true as const, sale: updated, before, after, previousTotal: sale.total };
}

export function createAutomaticSale(
  payload: SaleReadyPayload,
  options: { receivedAt?: string; ticket?: DeliveryTicket } = {}
): AutomaticSaleResult {
  if (typeof window === "undefined") {
    return {
      success: false,
      duplicate: false,
      error: "La venta automática solo puede crearse en el navegador.",
    };
  }

  if (!payload?.readyForSale || !payload.externalOrderKey) {
    return {
      success: false,
      duplicate: false,
      error: "El pedido no está preparado para venta.",
    };
  }

  const activeShift = localStorage.getItem(SHIFT_KEY);
  if (!activeShift) {
    return {
      success: false,
      duplicate: false,
      error: "La caja está cerrada. Abre turno para crear ventas automáticas.",
    };
  }

  const orders = readOrders();
  const incomingAt = Date.parse(options.receivedAt || "") || Date.now();
  const duplicate = orders.find(
    (order) => order.externalOrderKey === payload.externalOrderKey && Math.abs(incomingAt - Date.parse(order.createdAt)) < SAME_ORDER_WINDOW_MS
  );

  if (duplicate) {
    return {
      success: true,
      duplicate: true,
      orderId: duplicate.id,
      order: duplicate,
    };
  }

  const built = buildSaleItems(payload, options.ticket);
  if ("error" in built) return { success: false, duplicate: false, error: built.error };
  const items = built.items;

  const subtotal = items.reduce(
    (sum, item) => sum + Number(item.price || 0) * item.quantity,
    0
  );
  const id = nextOrderId(orders);
  let sequence;
  try {
    sequence = allocateShiftOrderNumber();
  } catch (error) {
    return {
      success: false,
      duplicate: false,
      error: error instanceof Error ? error.message : "No se pudo generar el folio del turno.",
    };
  }
  const label = platformLabel(payload.platform);
  // La venta lleva la hora real del pedido (no la de cuando se equivaló)
  const received = Date.parse(options.receivedAt || "");
  const createdAt = Number.isFinite(received) && received <= Date.now() ? new Date(received).toISOString() : new Date().toISOString();
  const late = Date.now() - Date.parse(createdAt) > LATE_SALE_MS;

  const order: AutomaticSaleOrder = {
    id,
    localOrderNumber: sequence.localOrderNumber,
    shiftSessionId: sequence.shiftSessionId,
    createdAt,
    items,
    details: {
      orderType: label,
      customerName: payload.customer?.name || "Cliente de plataforma",
      customerPhone: payload.customer?.phone || "",
      customerAddress: payload.delivery?.address || "",
      paymentMethod: label,
      discount: 0,
    },
    subtotal,
    total: subtotal,
    source: "B-POS Bridge",
    externalOrderNumber: payload.externalOrderId,
    externalOrderKey: payload.externalOrderKey,
    externalPlatform: payload.platform,
    externalTotal: Number(payload.externalTotal || 0),
    externalRawText: String(payload.rawText || ""),
    kdsTicketLines: Array.isArray(payload.kdsTicketLines) ? payload.kdsTicketLines : [],
    bridgeActions: {
      inventoryAdjustments: payload.inventoryAdjustments,
      ignoredLines: payload.ignoredLines,
    },
    status: late ? "Entregado" : "Nuevo",
    kdsReleased: true,
    kdsReleasedAt: new Date().toISOString(),
    kdsCompleted: late,
    ...(late ? { kdsCompletedAt: new Date().toISOString() } : {}),
    ...(options.ticket ? { deliveryTicket: options.ticket } : {}),
  };

  try {
    localStorage.setItem(ORDERS_KEY, JSON.stringify([...orders, order]));
    const storedOrders = readOrders();
    const released = storedOrders.some(
      (stored) => stored.id === order.id && stored.kdsReleased === true
    );
    if (!released) {
      throw new Error("La venta se guardó, pero no quedó liberada al KDS.");
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "No se pudo enviar la venta al KDS.";
    createKdsCriticalError({ orderId: order.id, message });
    return { success: false, duplicate: false, error: message };
  }

  // Los tickets de estación y de bolsa ya los imprimió el Bridge (tickets propios); aquí no se generan comandas.

  // Bloque 4: usa el mismo motor de inventario que las ventas normales.
  // La protección por externalOrderKey evita descuentos duplicados.
  const inventoryResult = applyInventoryForOrder(order);
  if (!inventoryResult.success) {
    console.error("Venta creada, pero inventario pendiente:", inventoryResult.error);
  }

  window.dispatchEvent(
    new CustomEvent("bpos:orders-updated", {
      detail: { orderId: order.id, source: "bridge" },
    })
  );
  notifyKdsUpdated(order.id);

  return {
    success: true,
    duplicate: false,
    orderId: order.id,
    order,
  };
}
