"use client";
/**
 * Pedidos en línea (los que mandan los clientes desde el menú digital) en
 * B-POS: se listan, se aceptan o se rechazan. Al aceptar, el pedido se
 * vuelve una venta más con los precios y opciones de B-POS (no los que
 * mandó el navegador del cliente): sale en Cocina, imprime comandas y entra
 * a la caja del turno.
 */
import { addAuditEvent } from "@/lib/audit";
import { getAdminProducts } from "@/lib/admin";
import { buildSelection, extrasPrice, lineIdFor } from "@/lib/compound";
import { getDigitalMenu, isAvailableOnline, type OnlineOrderData } from "@/lib/digital-menu";
import { discountInventoryByOrder } from "@/lib/inventory";
import { notifyKdsUpdated } from "@/lib/kds";
import { allocateShiftOrderNumber, formatOrderNumber } from "@/lib/order-sequence";
import { printSale, saleStations } from "@/lib/bridge/sale-tickets";
import { agentScope } from "@/lib/agent/client";
import { getSupabase } from "@/lib/supabase/client";
import type { CartItem } from "@/components/CartPanel";
import type { SavedOrder } from "@/components/OrderHistoryPanel";

export type OnlineOrderStatus = "nuevo" | "aceptando" | "aceptado" | "rechazado" | "listo" | "entregado";

export type OnlineOrder = {
  id: string;
  folio: string;
  status: OnlineOrderStatus;
  data: OnlineOrderData;
  sale_order_id: number | null;
  eta_minutes: number | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
};

export const ONLINE_ORDERS_EVENT = "bpos:online-orders-updated";
const ORDERS_KEY = "bpos_orders";

/** Pedidos de la sucursal de este dispositivo (los de hoy y los pendientes). */
export async function listOnlineOrders(): Promise<OnlineOrder[]> {
  const { branchId } = await agentScope();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await getSupabase()
    .from("bpos_online_orders")
    .select("id, folio, status, data, sale_order_id, eta_minutes, reason, created_at, updated_at")
    .eq("branch_id", branchId)
    .or(`created_at.gte.${since},status.in.(nuevo,aceptando)`)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data || []) as OnlineOrder[];
}

async function setStatus(id: string, patch: Partial<Pick<OnlineOrder, "status" | "sale_order_id" | "eta_minutes" | "reason">>) {
  const { error } = await getSupabase()
    .from("bpos_online_orders")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  window.dispatchEvent(new Event(ONLINE_ORDERS_EVENT));
}

function readOrders(): SavedOrder[] {
  try {
    return JSON.parse(localStorage.getItem(ORDERS_KEY) || "[]") as SavedOrder[];
  } catch {
    return [];
  }
}

/**
 * Renglones de la venta armados con el catálogo de B-POS. Regresa también lo
 * que ya no se puede vender (borrado, oculto o agotado) para avisar.
 */
export function buildOnlineCart(data: OnlineOrderData) {
  const catalog = getAdminProducts();
  const menu = getDigitalMenu();
  const cart: CartItem[] = [];
  const problems: string[] = [];
  for (const line of data.lines) {
    const product = catalog.find((p) => Number(p.id) === Number(line.productId));
    if (!product) {
      problems.push(`${line.name}: ya no existe en B-POS`);
      continue;
    }
    if (!isAvailableOnline(menu, product)) problems.push(`${product.name}: está agotado u oculto`);
    const selection = buildSelection(product, catalog, line.picks || {});
    const price = Number(product.price) + extrasPrice(selection.modifiers, selection.parts);
    const comment = String(line.comment || "").trim().slice(0, 140);
    const lineId = lineIdFor(product.id, selection.parts, selection.modifiers) + (comment ? `|c:${comment}` : "");
    const quantity = Math.max(1, Math.min(50, Math.round(Number(line.quantity) || 1)));
    const existing = cart.find((c) => c.lineId === lineId);
    if (existing) {
      existing.quantity += quantity;
      continue;
    }
    cart.push({
      ...product,
      station: product.station || "Cocina",
      price,
      quantity,
      lineId,
      ...(selection.parts?.length ? { parts: selection.parts, ownTicket: selection.ownTicket } : {}),
      ...(selection.modifiers?.length ? { modifiers: selection.modifiers } : {}),
      ...(selection.extraStations?.length ? { extraStations: selection.extraStations } : {}),
      ...(comment ? { comment } : {}),
    } as CartItem);
  }
  const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  return { cart, subtotal, problems };
}

const TYPE_LABEL: Record<OnlineOrderData["type"], string> = {
  Recoger: "En línea · Recoger",
  Domicilio: "En línea · Domicilio",
  Mesa: "En línea · Mesa",
};

/**
 * Acepta el pedido: lo "toma" en la nube (para que otro dispositivo no lo
 * acepte también), crea la venta del turno, descuenta inventario e imprime.
 */
export async function acceptOnlineOrder(order: OnlineOrder, etaMinutes: number, userName = "") {
  if (!localStorage.getItem("bpos_active_shift")) throw new Error("Abre la caja para aceptar pedidos en línea.");
  const { cart, subtotal } = buildOnlineCart(order.data);
  if (!cart.length) throw new Error("Ningún producto del pedido existe ya en B-POS. Recházalo.");

  const { data: claimed, error } = await getSupabase().rpc("bpos_online_claim", { p_id: order.id });
  if (error) throw new Error(error.message);
  if (!claimed) throw new Error("Otro dispositivo ya está atendiendo este pedido.");

  try {
    const sequence = allocateShiftOrderNumber();
    const orders = readOrders();
    // El envío va en el total (no es un producto: no pasa por cocina ni inventario)
    const deliveryFee = order.data.type === "Domicilio" ? Math.max(0, Number(getDigitalMenu().deliveryFee) || 0) : 0;
    const items = cart;
    const total = subtotal + deliveryFee;
    const c = order.data.customer;
    const tableNote = order.data.type === "Mesa" && order.data.table ? `Mesa ${order.data.table}` : "";
    const sale = {
      id: orders.reduce((max, o) => Math.max(max, Number(o.id) || 0), 0) + 1,
      localOrderNumber: sequence.localOrderNumber,
      shiftSessionId: sequence.shiftSessionId,
      createdAt: new Date().toISOString(),
      items,
      details: {
        orderType: TYPE_LABEL[order.data.type] || "En línea",
        customerName: [c.name, tableNote].filter(Boolean).join(" · "),
        customerPhone: c.phone || "",
        customerAddress: [c.address, c.reference, deliveryFee ? `Envío $${deliveryFee.toFixed(2)}` : ""].filter(Boolean).join(" · "),
        paymentMethod: order.data.payment || "Efectivo",
        discount: 0,
      },
      subtotal,
      total,
      ...(deliveryFee ? { deliveryFee } : {}),
      source: "Menú digital",
      onlineOrderId: order.id,
      onlineFolio: order.folio,
      ...(order.data.note ? { note: order.data.note } : {}),
    } as SavedOrder & { localOrderNumber: number; shiftSessionId: string };

    localStorage.setItem(ORDERS_KEY, JSON.stringify([...orders, sale]));
    window.dispatchEvent(new Event("bpos:orders-updated"));
    discountInventoryByOrder(sale.id, cart);
    notifyKdsUpdated(sale.id);
    await setStatus(order.id, { status: "aceptado", sale_order_id: sale.id, eta_minutes: etaMinutes });

    addAuditEvent({
      category: "Venta",
      action: "online.accepted",
      description: `${userName || "B-POS"} aceptó el pedido en línea ${order.folio} como Pedido #${formatOrderNumber(sale)} por $${total.toFixed(2)}`,
      entityId: String(sale.id),
      metadata: { folio: order.folio, total, type: order.data.type },
    });

    // Comandas por estación y ticket del cliente en Caja
    const failed = await printSale(sale, { stations: saleStations(sale), customer: true }, false).catch(() => ["impresoras"]);
    return { sale, printFailed: failed };
  } catch (e) {
    // Si algo falló antes de crear la venta, el pedido vuelve a "nuevo"
    const current = readOrders().some((o) => (o as { onlineOrderId?: string }).onlineOrderId === order.id);
    if (!current) await setStatus(order.id, { status: "nuevo" }).catch(() => undefined);
    throw e;
  }
}

export async function rejectOnlineOrder(order: OnlineOrder, reason: string, userName = "") {
  await setStatus(order.id, { status: "rechazado", reason: reason.trim().slice(0, 200) || "El negocio no pudo tomar tu pedido." });
  addAuditEvent({
    category: "Venta",
    action: "online.rejected",
    description: `${userName || "B-POS"} rechazó el pedido en línea ${order.folio}: ${reason || "sin motivo"}`,
    metadata: { folio: order.folio },
  });
}

/** Avisa al cliente que su pedido está listo o entregado. */
export function markOnlineOrder(order: OnlineOrder, status: "listo" | "entregado") {
  return setStatus(order.id, { status });
}
