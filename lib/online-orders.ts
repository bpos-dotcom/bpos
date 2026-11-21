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
import { aiFetch } from "@/lib/ai/client";
import { awaitingOnlinePayment, endOfToday, getDigitalMenu, isAvailableOnline, kioskLabel, mapsLink, paidOnline, saveDigitalMenu, scheduledLabel, whatsappNumber, type OnlineOrderData, type OnlineOrderEdit } from "@/lib/digital-menu";
import { PUSH_SERVER } from "@/lib/push/rules";
import { checkCoupon, countCouponUse } from "@/lib/coupons";
import { evaluatePromotion, onlineDiscount, promoLabel } from "@/lib/promotions";
import { earnLoyalty } from "@/lib/loyalty-pos";
import { getBusinessSettings } from "@/lib/business-settings";
import type { DispatchInfo } from "@/lib/drivers";
import { correctInventoryForOrder, discountInventoryByOrder, type InventoryOrderLike } from "@/lib/inventory";
import { notifyKdsUpdated } from "@/lib/kds";
import { allocateShiftOrderNumber, formatOrderNumber } from "@/lib/order-sequence";
import { printSale, saleStations } from "@/lib/bridge/sale-tickets";
import { agentScope } from "@/lib/agent/client";
import { getSupabase } from "@/lib/supabase/client";
import type { CartItem } from "@/components/CartPanel";
import type { SavedOrder } from "@/components/OrderHistoryPanel";
import { whatsappLink } from "@/lib/whatsapp";

export type OnlineOrderStatus = "nuevo" | "aceptando" | "aceptado" | "rechazado" | "listo" | "entregado";

export type OnlineOrder = {
  id: string;
  folio: string;
  /** Llave de la liga del cliente para ver su pedido */
  token: string;
  /** Cuenta del cliente (si pidió con su cuenta): suma al club */
  account_id?: string | null;
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
    .select("id, folio, token, account_id, status, data, sale_order_id, eta_minutes, reason, created_at, updated_at")
    .eq("branch_id", branchId)
    .or(`created_at.gte.${since},status.in.(nuevo,aceptando)`)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data || []) as OnlineOrder[];
}

async function setStatus(id: string, patch: Partial<Pick<OnlineOrder, "status" | "sale_order_id" | "eta_minutes" | "reason" | "data">>) {
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
  // El cupón se vuelve a revisar con los precios de B-POS
  let coupon: { code: string; discount: number } | null = null;
  if (data.coupon?.code) {
    const check = checkCoupon(data.coupon.code, subtotal, "online");
    if (check.ok) coupon = { code: check.coupon.code, discount: check.discount };
    else problems.push(`Cupón ${data.coupon.code}: ${check.error} Se cobrará sin descuento.`);
  }
  // La promoción también se vuelve a calcular con los precios de B-POS (para quién es se revisa al aceptar)
  let promo: { id: string; name: string; discount: number; freeShipping?: boolean } | null = null;
  if (data.promo?.id) {
    const p = getDigitalMenu().promotions.find((x) => x.id === data.promo!.id);
    const r = p
      ? evaluatePromotion(p, {
          lines: cart.map((i) => ({ productId: Number(i.id), category: i.category || "", unitPrice: i.price, quantity: i.quantity })),
          subtotal,
          delivery: data.type === "Domicilio",
          deliveryFee: 0,
          isNew: true,
          isClub: true,
        })
      : null;
    if (p && r) promo = { id: p.id, name: data.promo.name || promoLabel(p), discount: r.discount, ...(r.freeShipping ? { freeShipping: true } : {}) };
    else problems.push(`Promoción "${data.promo.name}": ya no aplica. Se cobrará sin la promoción.`);
  }
  return { cart, subtotal, problems, coupon, promo };
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
export async function acceptOnlineOrder(order: OnlineOrder, etaMinutes: number, userName = "", options: { deliveryFee?: number } = {}) {
  if (!localStorage.getItem("bpos_active_shift")) throw new Error("Abre la caja para aceptar pedidos en línea.");
  if (awaitingOnlinePayment(order.data)) throw new Error("El cliente todavía no termina de pagar con Mercado Pago.");
  if (order.data.mp?.status === "refunded") throw new Error("Ya se le devolvió el pago de este pedido.");
  const built = buildOnlineCart(order.data);
  const { cart, subtotal, coupon } = built;
  if (!cart.length) throw new Error("Ningún producto del pedido existe ya en B-POS. Recházalo.");
  // Promoción solo para clientes nuevos o del club: se revisa que de verdad le toque
  const promoProblem = built.promo ? await promoAudienceProblem(order) : "";
  const promo = promoProblem ? null : built.promo;
  const short = onlinePaymentShort(order.data);
  if (short) throw new Error(short);

  const { data: claimed, error } = await getSupabase().rpc("bpos_online_claim", { p_id: order.id });
  if (error) throw new Error(error.message);
  if (!claimed) throw new Error("Otro dispositivo ya está atendiendo este pedido.");

  try {
    const sequence = allocateShiftOrderNumber();
    const orders = readOrders();
    // El envío va en el total (no es un producto: no pasa por cocina ni inventario).
    // A cotizar: lo que puso el negocio al aceptar; si no, la cuota fija del menú.
    const deliveryFee =
      order.data.type !== "Domicilio" || promo?.freeShipping
        ? 0
        : order.data.deliveryQuote
          ? Math.max(0, Number(options.deliveryFee) || 0)
          : Math.max(0, Number(getDigitalMenu().deliveryFee) || 0);
    const items = cart;
    const discount = Math.round(((coupon?.discount || 0) + (promo?.discount || 0)) * 100) / 100;
    const total = Math.max(0, subtotal + deliveryFee - discount);
    const c = order.data.customer;
    const tableNote = order.data.type === "Mesa" && order.data.table ? `Mesa ${order.data.table}` : "";
    const sale = {
      id: orders.reduce((max, o) => Math.max(max, Number(o.id) || 0), 0) + 1,
      localOrderNumber: sequence.localOrderNumber,
      shiftSessionId: sequence.shiftSessionId,
      createdAt: new Date().toISOString(),
      items,
      details: {
        orderType: kioskLabel(order.data) || TYPE_LABEL[order.data.type] || "En línea",
        customerName: [c.name, tableNote].filter(Boolean).join(" · "),
        customerPhone: c.phone || "",
        customerAddress: [c.address, c.reference, deliveryFee ? `Envío $${deliveryFee.toFixed(2)}${paidOnline(order.data) ? " (cobrar al entregar)" : ""}` : ""].filter(Boolean).join(" · "),
        // Pagado en línea: entra a la caja como "Mercado Pago" (no es efectivo del cajón)
        paymentMethod: order.data.payment || "Efectivo",
        discount,
        ...(coupon ? { couponCode: coupon.code } : {}),
        ...(promo ? { promoName: promo.name } : {}),
      },
      subtotal,
      total,
      ...(deliveryFee ? { deliveryFee } : {}),
      // Se paga al recoger o al recibir: queda en Cuentas en espera (POS) hasta que el cliente pague.
      // Pagado en línea o en la terminal del kiosco: ya está cobrado.
      pendingPayment: !(paidOnline(order.data) || Boolean(order.data.kiosk)),
      paidAt: paidOnline(order.data) || order.data.kiosk ? new Date().toISOString() : undefined,
      source: order.data.kiosk ? "Kiosco" : "Menú digital",
      onlineOrderId: order.id,
      onlineFolio: order.folio,
      ...(order.data.note ? { note: order.data.note } : {}),
    } as SavedOrder & { localOrderNumber: number; shiftSessionId: string };

    localStorage.setItem(ORDERS_KEY, JSON.stringify([...orders, sale]));
    window.dispatchEvent(new Event("bpos:orders-updated"));
    if (coupon) countCouponUse(coupon.code);
    // Club: si pidió con su cuenta y es socio, se le suma (una sola vez por pedido)
    if (order.account_id) void earnLoyalty(order.account_id, total, `online:${order.id}`, userName);
    discountInventoryByOrder(sale.id, cart);
    notifyKdsUpdated(sale.id);
    await setStatus(order.id, {
      status: "aceptado",
      sale_order_id: sale.id,
      eta_minutes: etaMinutes,
      // Envío cotizado: el cliente ve el costo y su total actualizado en su liga
      ...(order.data.deliveryQuote
        ? { data: { ...order.data, deliveryFee, total: Math.max(0, Number(order.data.subtotal) + deliveryFee - onlineDiscount(order.data)) } }
        : {}),
    });

    addAuditEvent({
      category: "Venta",
      action: "online.accepted",
      description: `${userName || "B-POS"} aceptó el pedido en línea ${order.folio} como Pedido #${formatOrderNumber(sale)} por $${total.toFixed(2)}`,
      entityId: String(sale.id),
      metadata: { folio: order.folio, total, type: order.data.type, ...(promo ? { promo: promo.name } : {}) },
    });
    if (promoProblem) {
      addAuditEvent({
        category: "Venta",
        action: "online.promo_removed",
        description: `Pedido en línea ${order.folio}: se cobró sin la promoción "${order.data.promo?.name || ""}" (${promoProblem})`,
        entityId: String(sale.id),
      });
    }

    // Comandas por estación y ticket del cliente en Caja
    const failed = await printSale(sale, { stations: saleStations(sale), customer: true }, false).catch(() => ["impresoras"]);
    return { sale, printFailed: failed, promoProblem };
  } catch (e) {
    // Si algo falló antes de crear la venta, el pedido vuelve a "nuevo"
    const current = readOrders().some((o) => (o as { onlineOrderId?: string }).onlineOrderId === order.id);
    if (!current) await setStatus(order.id, { status: "nuevo" }).catch(() => undefined);
    throw e;
  }
}

const phone10 = (v: unknown) => String(v || "").replace(/\D/g, "").slice(-10);

/**
 * Promoción para clientes nuevos o del club: ¿de verdad le toca? "" = sí.
 * Nuevo: ese teléfono no tiene pedidos en línea antes de este ni ventas en
 * esta caja. Club: pidió con su cuenta y es socio. Si no hay internet para
 * revisar, se le respeta.
 */
export async function promoAudienceProblem(order: Pick<OnlineOrder, "id" | "data" | "account_id" | "created_at">): Promise<string> {
  const p = getDigitalMenu().promotions.find((x) => x.id === order.data.promo?.id);
  if (!p || p.audience === "all") return "";
  try {
    if (p.audience === "club") {
      if (!order.account_id) return "no pidió con su cuenta del club";
      const { data, error } = await getSupabase().from("bpos_loyalty_members").select("account_id").eq("account_id", order.account_id).maybeSingle();
      if (error) return "";
      return data ? "" : "no es socio del club";
    }
    const phone = phone10(order.data.customer.phone);
    if (phone.length !== 10) return "no dejó su teléfono";
    const { count, error } = await getSupabase()
      .from("bpos_online_orders")
      .select("id", { count: "exact", head: true })
      .neq("id", order.id)
      .neq("status", "rechazado")
      .lt("created_at", order.created_at)
      .like("data->customer->>phone", `%${phone}`);
    if (!error && (count || 0) > 0) return "ese teléfono ya había pedido antes";
  } catch {
    return "";
  }
  const phone = phone10(order.data.customer.phone);
  const sold = readOrders().some((o) => phone10((o as { details?: { customerPhone?: string } }).details?.customerPhone) === phone && (o as { onlineOrderId?: string }).onlineOrderId !== order.id);
  return sold ? "ese teléfono ya había comprado antes" : "";
}

/**
 * Pagado en línea por menos de lo que vale con los precios de B-POS (alguien
 * cambió el total): no se acepta. "" si está bien o no es pago en línea.
 */
export function onlinePaymentShort(data: OnlineOrderData) {
  if (!paidOnline(data) || !data.mp) return "";
  const { subtotal, coupon, promo } = buildOnlineCart(data);
  const fee = data.type === "Domicilio" && !data.deliveryQuote && !promo?.freeShipping ? Math.max(0, Number(getDigitalMenu().deliveryFee) || 0) : 0;
  const total = Math.max(0, subtotal + fee - (coupon?.discount || 0) - (promo?.discount || 0));
  return data.mp.amount + 0.5 < total
    ? `El cliente pagó ${data.mp.amount.toFixed(2)} pero con tus precios el pedido es de ${total.toFixed(2)}. Recházalo (se le devuelve su pago) o pídele la diferencia.`
    : "";
}

/** Rechaza el pedido; si ya pagó con Mercado Pago, se le devuelve. Regresa el aviso si no se pudo devolver. */
export async function rejectOnlineOrder(order: OnlineOrder, reason: string, userName = "") {
  let refundError = "";
  if (paidOnline(order.data)) {
    try {
      const r = await aiFetch("/api/mp/menu-refund", { method: "POST", body: JSON.stringify({ id: order.id }) });
      const b = await r.json().catch(() => null);
      if (!r.ok || !b?.success) throw new Error(b?.error || "Mercado Pago no respondió.");
    } catch (e) {
      refundError = `No se pudo devolver el pago (${e instanceof Error ? e.message : "error"}). Devuélvelo desde tu cuenta de Mercado Pago.`;
    }
  }
  await setStatus(order.id, { status: "rechazado", reason: reason.trim().slice(0, 200) || "El negocio no pudo tomar tu pedido." });
  addAuditEvent({
    category: "Venta",
    action: "online.rejected",
    description: `${userName || "B-POS"} rechazó el pedido en línea ${order.folio}: ${reason || "sin motivo"}${paidOnline(order.data) ? (refundError ? " (el pago no se pudo devolver)" : " (se devolvió el pago)") : ""}`,
    metadata: { folio: order.folio },
  });
  return { refundError };
}

/** Pedido que eligió Mercado Pago y no se pagó en 2 horas: se cierra solo. */
export async function expireUnpaidOrder(order: OnlineOrder) {
  if (!awaitingOnlinePayment(order.data) || Date.now() - Date.parse(order.created_at) < 2 * 60 * 60 * 1000) return false;
  await setStatus(order.id, { status: "rechazado", reason: "No se completó el pago en línea." });
  return true;
}

/** Datos del pedido leídos de nuevo (para cambiar algo sin pisar otros cambios, ej. el pago) */
async function freshData(order: OnlineOrder) {
  const { data: fresh, error } = await getSupabase().from("bpos_online_orders").select("data").eq("id", order.id).single();
  if (error) throw new Error(error.message);
  return (fresh?.data || order.data) as OnlineOrderData;
}

// ------------------------------------------------------------ modificar el pedido antes de aceptarlo

/** Por qué no se puede modificar ("" si se puede) */
export function editBlocked(order: Pick<OnlineOrder, "status" | "data">) {
  if (order.status !== "nuevo" && order.status !== "aceptado" && order.status !== "listo") return order.status === "entregado" ? "Ya se entregó: los cambios se hacen desde Historial de pedidos." : "Este pedido ya no se puede modificar.";
  if (order.data.kiosk || paidOnline(order.data)) return "Ya lo pagó en línea: para cambiarlo, recházalo (se le devuelve su pago) y que lo vuelva a pedir.";
  return "";
}

/**
 * Pedido con las cantidades nuevas (una por renglón; 0 = se quita). Recalcula
 * subtotal, cupón (no puede ser mayor que el subtotal) y total, y anota el cambio.
 */
export function applyOrderEdit(data: OnlineOrderData, quantities: number[], reason: string, by = "", now = new Date()): OnlineOrderData {
  const why = reason.trim();
  if (!why) throw new Error("Escribe el motivo.");
  if (quantities.length !== data.lines.length) throw new Error("El pedido cambió: vuelve a abrirlo.");
  const removed: OnlineOrderEdit["removed"] = [];
  const lines = data.lines
    .map((l, i) => {
      const q = Math.max(0, Math.min(l.quantity, Math.floor(Number(quantities[i]) || 0)));
      if (q < l.quantity) removed.push({ name: l.name, quantity: l.quantity - q });
      return { ...l, quantity: q };
    })
    .filter((l) => l.quantity > 0);
  if (!removed.length) throw new Error("No quitaste nada.");
  if (!lines.length) throw new Error("Si no queda nada, mejor rechaza el pedido.");
  const subtotal = Math.round(lines.reduce((a, l) => a + l.unitPrice * l.quantity, 0) * 100) / 100;
  const coupon = data.coupon ? { ...data.coupon, discount: Math.min(data.coupon.discount, subtotal) } : undefined;
  const promo = data.promo ? { ...data.promo, discount: Math.min(data.promo.discount, Math.max(0, subtotal - (coupon?.discount || 0))) } : undefined;
  const total = Math.max(0, Math.round((subtotal + (Number(data.deliveryFee) || 0) - onlineDiscount({ coupon, promo })) * 100) / 100);
  const edit: OnlineOrderEdit = { at: now.toISOString(), ...(by ? { by } : {}), removed, reason: why, totalBefore: data.total, totalAfter: total };
  return { ...data, lines, subtotal, ...(coupon ? { coupon } : {}), ...(promo ? { promo } : {}), total, edits: [...(data.edits || []), edit] };
}

/** Mensaje para el cliente con lo que se quitó y su total nuevo */
export function editNoticeText(order: Pick<OnlineOrder, "folio" | "data">, edit: OnlineOrderEdit) {
  const name = (order.data.customer.name || "").trim().split(/\s+/)[0] || "";
  const business = getBusinessSettings().businessName || "nuestro negocio";
  const what = edit.removed.map((r) => `${r.quantity} × ${r.name}`).join(", ");
  const why = edit.reason.toLowerCase() === "agotado" ? "se nos agotó" : edit.reason;
  const quote = order.data.type === "Domicilio" && order.data.deliveryQuote && !order.data.deliveryFee ? " + envío" : "";
  return `¡Hola${name ? ` ${name}` : ""}! Hicimos un cambio a tu pedido *${order.folio}* en ${business}: quitamos ${what} (${why}). Tu nuevo total es *$${edit.totalAfter.toFixed(2)}${quote}*. ¡Disculpa!`;
}

type SaleItem = SavedOrder["items"][number] & { lineId?: string };

/**
 * Venta de la caja con lo que se quitó del pedido en línea. Compara el carrito
 * de antes y el de después renglón por renglón (mismo producto, opciones y
 * comentario) y baja esas piezas de la venta con sus precios de la caja.
 */
export function saleAfterEdit<T extends { items: SaleItem[]; subtotal?: number; total: number; deliveryFee?: number; details: { discount?: number } }>(sale: T, before: CartItem[], after: CartItem[]) {
  const left = new Map<string, number>();
  for (const i of before) left.set(i.lineId || String(i.id), (left.get(i.lineId || String(i.id)) || 0) + i.quantity);
  for (const i of after) left.set(i.lineId || String(i.id), (left.get(i.lineId || String(i.id)) || 0) - i.quantity);
  const removed: SaleItem[] = [];
  const items = sale.items
    .map((item) => {
      const key = item.lineId || String(item.id);
      const take = Math.min(item.quantity, Math.max(0, left.get(key) || 0));
      if (!take) return item;
      left.set(key, (left.get(key) || 0) - take);
      removed.push({ ...item, quantity: take });
      return { ...item, quantity: item.quantity - take };
    })
    .filter((i) => i.quantity > 0);
  const subtotal = Math.round(items.reduce((s, i) => s + i.price * i.quantity, 0) * 100) / 100;
  const discount = Math.min(Number(sale.details.discount) || 0, subtotal);
  const total = Math.max(0, Math.round((subtotal - discount + (Number(sale.deliveryFee) || 0)) * 100) / 100);
  return { sale: { ...sale, items, subtotal, total, details: { ...sale.details, discount } }, removed };
}

/**
 * Pedido ya aceptado: ajusta su venta en la caja, el inventario (regresa lo
 * quitado o lo anota como merma si ya se preparó), la pantalla de cocina y
 * saca en la estación un ticket de "QUITAR" y el ticket del cliente corregido.
 */
async function editAcceptedSale(order: OnlineOrder, before: OnlineOrderData, after: OnlineOrderData, reason: string, prepared: boolean) {
  const orders = readOrders();
  const sale = orders.find((o) => (o as { onlineOrderId?: string }).onlineOrderId === order.id || (order.sale_order_id && o.id === order.sale_order_id)) as (SavedOrder & { items: SaleItem[]; deliveryFee?: number; localOrderNumber?: number }) | undefined;
  if (!sale) throw new Error("No encuentro su venta en esta caja. Modifícalo desde la caja donde se aceptó.");
  if (sale.cancelled) throw new Error("Su venta ya está cancelada.");
  if (!sale.pendingPayment) throw new Error("Ya se cobró en caja: haz la devolución desde Historial de pedidos.");
  const result = saleAfterEdit(sale, buildOnlineCart(before).cart, buildOnlineCart(after).cart);
  if (!result.removed.length) throw new Error("No encontré esos productos en la venta de la caja.");
  const updated = result.sale as SavedOrder;
  localStorage.setItem(ORDERS_KEY, JSON.stringify(orders.map((o) => (o.id === sale.id ? updated : o))));
  window.dispatchEvent(new Event("bpos:orders-updated"));
  const what = result.removed.map((i) => `${i.quantity}x ${i.name}`).join(", ");
  try {
    correctInventoryForOrder(updated as unknown as InventoryOrderLike, `pedido en línea ${order.folio}: se quitó ${what} (${reason})`, prepared ? (result.removed as unknown as InventoryOrderLike["items"]) : []);
  } catch (error) {
    console.error("No se pudo ajustar el inventario al modificar el pedido:", error);
  }
  notifyKdsUpdated(sale.id);
  // Comanda de "QUITAR" en las estaciones de lo quitado y el ticket del cliente con el total nuevo
  const quitar = { ...updated, items: result.removed, details: { ...updated.details, orderType: `❌ QUITAR · ${updated.details.orderType || "En línea"}` } } as SavedOrder;
  const printFailed = [
    ...(await printSale(quitar, { stations: saleStations(quitar), customer: false }, true).catch(() => ["cocina: B-POS Agent no respondió"])),
    ...(await printSale(updated, { stations: [], customer: true, drawer: false }, true).catch(() => ["caja: B-POS Agent no respondió"])),
  ];
  return { sale: updated, saleBefore: sale.total, removed: what, printFailed };
}

/**
 * Guarda el cambio. Con "Agotado" puede marcar agotados hoy en el menú los
 * productos que se quitaron completos, para que nadie más los pida. Si ya se
 * aceptó, también ajusta la venta de la caja, el inventario y la cocina.
 */
export async function editOnlineOrder(order: OnlineOrder, quantities: number[], reason: string, options: { userName?: string; markSoldOut?: boolean; prepared?: boolean } = {}) {
  const blocked = editBlocked(order);
  if (blocked) throw new Error(blocked);
  const fresh = await freshData(order);
  if (JSON.stringify(fresh.lines) !== JSON.stringify(order.data.lines)) throw new Error("El pedido cambió en otro dispositivo: revisa y vuelve a intentar.");
  const data = applyOrderEdit(fresh, quantities, reason, options.userName);
  const accepted = order.status !== "nuevo" ? await editAcceptedSale(order, fresh, data, reason.trim(), Boolean(options.prepared)) : null;
  const edit = data.edits![data.edits!.length - 1];
  // Ya aceptado: lo que se cobra es lo de la caja (con los precios de B-POS)
  if (accepted) {
    edit.totalBefore = accepted.saleBefore;
    edit.totalAfter = accepted.sale.total;
    data.total = accepted.sale.total;
  }
  await setStatus(order.id, { data });
  if (options.markSoldOut) {
    const gone = order.data.lines.filter((l, i) => !(Number(quantities[i]) > 0)).map((l) => l.productId);
    if (gone.length) {
      const menu = getDigitalMenu();
      const soldOut = { ...menu.soldOut };
      for (const id of gone) soldOut[String(id)] = { until: endOfToday(), at: new Date().toISOString() };
      saveDigitalMenu({ soldOut });
    }
  }
  addAuditEvent({
    category: "Pedidos",
    action: "online_order.edit",
    description:
      `${options.userName || "B-POS"} modificó el pedido en línea ${order.folio}${accepted ? ` (Pedido #${formatOrderNumber(accepted.sale as SavedOrder & { localOrderNumber?: number })}, ya en cocina)` : ""}: quitó ${edit.removed.map((r) => `${r.quantity} × ${r.name}`).join(", ")} (${edit.reason}). ` +
      (accepted ? `Cobro $${accepted.saleBefore.toFixed(2)} → $${accepted.sale.total.toFixed(2)}${options.prepared ? " · ya se había preparado (merma)" : ""}` : `Total $${edit.totalBefore.toFixed(2)} → $${edit.totalAfter.toFixed(2)}`),
    entityId: order.id,
    metadata: { folio: order.folio, total: accepted ? accepted.sale.total : edit.totalAfter, before: accepted ? accepted.saleBefore : edit.totalBefore, accepted: Boolean(accepted) },
  });
  return { order: { ...order, data }, edit, printFailed: accepted?.printFailed || [] };
}

/**
 * Hora en que un programado se manda solo a cocina. Tiene que ser después de
 * ahora y antes de la hora que pidió el cliente.
 */
export function checkKitchenAt(order: Pick<OnlineOrder, "data">, at: Date, now = Date.now()) {
  const due = Date.parse(order.data.scheduledFor || "");
  if (!Number.isFinite(at.getTime())) return "Elige una hora.";
  if (Number.isFinite(due) && at.getTime() > due) return "Tiene que ser antes de la hora que pidió el cliente.";
  if (at.getTime() <= now) return "Esa hora ya pasó: mándalo ahora.";
  return "";
}

export async function setOnlineKitchenAt(order: OnlineOrder, at: Date) {
  const problem = checkKitchenAt(order, at);
  if (problem) throw new Error(problem);
  const data = await freshData(order);
  await setStatus(order.id, { data: { ...data, kitchenAt: at.toISOString() } });
  addAuditEvent({
    category: "Pedidos",
    action: "online_order.kitchen_at",
    description: `El programado ${order.folio} se mandará a cocina a las ${at.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" })}`,
    entityId: order.id,
  });
}

/**
 * Corrige el teléfono del cliente (si lo escribió mal). Lee el pedido de nuevo
 * para no pisar otros cambios (ej. el pago) y solo cambia el número.
 */
export async function updateOnlineCustomerPhone(order: OnlineOrder, phone: string) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!whatsappNumber(digits)) throw new Error("Escribe el número a 10 dígitos.");
  const clean = digits.slice(-10);
  const data = await freshData(order);
  const before = data.customer?.phone || "";
  await setStatus(order.id, { data: { ...data, customer: { ...data.customer, phone: clean } } });
  addAuditEvent({ category: "Pedidos", action: "online_order.phone", description: `Se corrigió el teléfono del pedido ${order.folio}: ${before || "(vacío)"} → ${clean}`, entityId: order.id });
  return clean;
}

/** Avisa al cliente que su pedido está listo o entregado. */
export function markOnlineOrder(order: OnlineOrder, status: "listo" | "entregado") {
  return setStatus(order.id, { status });
}

// ------------------------------------------------------------ avisos al cliente por WhatsApp

/** Liga donde el cliente ve cómo va su pedido */
export function trackingLink(order: Pick<OnlineOrder, "id" | "token">) {
  const slug = getDigitalMenu().slug;
  return slug && order.token ? `${PUSH_SERVER}/m/${slug}?pedido=${order.id}&t=${order.token}` : "";
}

export type CustomerNotice = "aceptado" | "listo" | "entregado" | "rechazado";

/** Qué aviso le toca al cliente según cómo va su pedido ("" si ninguno) */
export function noticeFor(status: OnlineOrderStatus): CustomerNotice | "" {
  return status === "aceptado" || status === "listo" || status === "entregado" || status === "rechazado" ? status : "";
}

/**
 * Liga de WhatsApp (wa.me, gratis) con el aviso ya escrito para el cliente;
 * "" si no dejó un teléfono válido. El negocio solo le da enviar.
 */
export function customerWhatsappLink(order: OnlineOrder, notice: CustomerNotice, opts: { eta?: number; reason?: string } = {}) {
  const phone = whatsappNumber(order.data.customer.phone);
  return phone ? whatsappLink(phone, customerNoticeText(order, notice, opts)) : "";
}

/** Confirmación de un pedido programado (para mandarla por WhatsApp o copiarla) */
export function scheduledConfirmText(order: OnlineOrder) {
  const d = order.data;
  const name = (d.customer.name || "").trim().split(/\s+/)[0] || "";
  return `¡Hola${name ? ` ${name}` : ""}! Recibimos tu pedido programado ${order.folio} para ${d.scheduledFor ? scheduledLabel(d.scheduledFor) : "la hora que elegiste"}. ¡Te esperamos! 🧡`;
}

/** Texto del aviso al cliente (el mismo de WhatsApp), para copiarlo y mandarlo a mano */
export function customerNoticeText(order: OnlineOrder, notice: CustomerNotice, opts: { eta?: number; reason?: string } = {}) {
  const d = order.data;
  const business = getBusinessSettings().businessName || "nuestro negocio";
  const name = (d.customer.name || "").trim().split(/\s+/)[0] || "";
  const hi = name ? `${name}, ` : "";
  const link = trackingLink(order);
  const follow = link ? `\n\nSíguelo aquí: ${link}` : "";
  const eta = opts.eta ?? order.eta_minutes ?? 0;
  const at = eta ? new Date(Date.now() + eta * 60000).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" }) : "";
  const texts: Record<CustomerNotice, string> = {
    aceptado:
      `¡Hola${name ? ` ${name}` : ""}! 👨‍🍳 Recibimos tu pedido *${order.folio}* en ${business} y ya lo estamos preparando.` +
      (at ? ` Estará ${d.type === "Domicilio" ? "saliendo" : "listo"} aprox. a las ${at}.` : "") +
      follow,
    listo:
      d.type === "Domicilio"
        ? `🛵 ¡${hi}tu pedido *${order.folio}* de ${business} ya va en camino! Ten a la mano tu pago (${d.payment}).${follow}`
        : d.type === "Mesa"
          ? `✅ ¡${hi}tu pedido *${order.folio}* ya está listo y va a tu mesa!`
          : `✅ ¡${hi}tu pedido *${order.folio}* ya está listo! Pasa a recogerlo a ${business}.${follow}`,
    entregado: `🎉 ¡Gracias por tu pedido${name ? `, ${name}` : ""}! Esperamos que lo disfrutes 😋${link ? `\n\n¿Cómo te fue? Califícanos aquí, son 5 segundos ⭐: ${link}` : ""}`,
    rechazado:
      `😔 ${hi}lo sentimos: no pudimos tomar tu pedido *${order.folio}* en ${business}.` + (opts.reason || order.reason ? `\nMotivo: ${opts.reason || order.reason}` : ""),
  };
  return texts[notice];
}

/** Datos para el repartidor de un pedido del menú digital. */
export function onlineDispatchInfo(order: OnlineOrder): DispatchInfo {
  const d = order.data;
  const c = d.customer;
  return {
    title: `Folio ${order.folio}`,
    businessName: getBusinessSettings().businessName,
    customer: { name: c.name, phone: c.phone, address: c.address, reference: c.reference, mapsUrl: mapsLink(c.location) || undefined },
    lines: d.lines.map((l) => ({ quantity: l.quantity, name: l.name, detail: [l.summary, l.comment].filter(Boolean).join(" · ") || undefined })),
    total: d.total,
    // Transferencia: el negocio ya revisó el comprobante; efectivo o tarjeta se cobran al entregar
    payment:
      d.payment === "Transferencia" || paidOnline(d)
        ? { paid: true, method: d.payment }
        : { paid: false, method: d.payment === "Tarjeta" ? "Tarjeta (lleva la terminal)" : "Efectivo", amount: d.total, ...(d.cashWith ? { cashWith: d.cashWith } : {}) },
    note: d.note || undefined,
  };
}
