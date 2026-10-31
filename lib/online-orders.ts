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
import { awaitingOnlinePayment, getDigitalMenu, isAvailableOnline, mapsLink, paidOnline, whatsappNumber, type OnlineOrderData } from "@/lib/digital-menu";
import { PUSH_SERVER } from "@/lib/push/rules";
import { checkCoupon, countCouponUse } from "@/lib/coupons";
import { earnLoyalty } from "@/lib/loyalty-pos";
import { getBusinessSettings } from "@/lib/business-settings";
import type { DispatchInfo } from "@/lib/drivers";
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
  // El cupón se vuelve a revisar con los precios de B-POS
  let coupon: { code: string; discount: number } | null = null;
  if (data.coupon?.code) {
    const check = checkCoupon(data.coupon.code, subtotal, "online");
    if (check.ok) coupon = { code: check.coupon.code, discount: check.discount };
    else problems.push(`Cupón ${data.coupon.code}: ${check.error} Se cobrará sin descuento.`);
  }
  return { cart, subtotal, problems, coupon };
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
  if (awaitingOnlinePayment(order.data)) throw new Error("El cliente todavía no termina de pagar con Mercado Pago.");
  if (order.data.mp?.status === "refunded") throw new Error("Ya se le devolvió el pago de este pedido.");
  const { cart, subtotal, coupon } = buildOnlineCart(order.data);
  if (!cart.length) throw new Error("Ningún producto del pedido existe ya en B-POS. Recházalo.");
  const short = onlinePaymentShort(order.data);
  if (short) throw new Error(short);

  const { data: claimed, error } = await getSupabase().rpc("bpos_online_claim", { p_id: order.id });
  if (error) throw new Error(error.message);
  if (!claimed) throw new Error("Otro dispositivo ya está atendiendo este pedido.");

  try {
    const sequence = allocateShiftOrderNumber();
    const orders = readOrders();
    // El envío va en el total (no es un producto: no pasa por cocina ni inventario)
    const deliveryFee = order.data.type === "Domicilio" ? Math.max(0, Number(getDigitalMenu().deliveryFee) || 0) : 0;
    const items = cart;
    const discount = coupon?.discount || 0;
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
        orderType: TYPE_LABEL[order.data.type] || "En línea",
        customerName: [c.name, tableNote].filter(Boolean).join(" · "),
        customerPhone: c.phone || "",
        customerAddress: [c.address, c.reference, deliveryFee ? `Envío $${deliveryFee.toFixed(2)}` : ""].filter(Boolean).join(" · "),
        // Pagado en línea: entra a la caja como "Mercado Pago" (no es efectivo del cajón)
        paymentMethod: order.data.payment || "Efectivo",
        discount,
        ...(coupon ? { couponCode: coupon.code } : {}),
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
    if (coupon) countCouponUse(coupon.code);
    // Club: si pidió con su cuenta y es socio, se le suma (una sola vez por pedido)
    if (order.account_id) void earnLoyalty(order.account_id, total, `online:${order.id}`, userName);
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

/**
 * Pagado en línea por menos de lo que vale con los precios de B-POS (alguien
 * cambió el total): no se acepta. "" si está bien o no es pago en línea.
 */
export function onlinePaymentShort(data: OnlineOrderData) {
  if (!paidOnline(data) || !data.mp) return "";
  const { subtotal, coupon } = buildOnlineCart(data);
  const fee = data.type === "Domicilio" ? Math.max(0, Number(getDigitalMenu().deliveryFee) || 0) : 0;
  const total = Math.max(0, subtotal + fee - (coupon?.discount || 0));
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
  const d = order.data;
  const phone = whatsappNumber(d.customer.phone);
  if (!phone) return "";
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
  return `https://wa.me/${phone}?text=${encodeURIComponent(texts[notice])}`;
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
