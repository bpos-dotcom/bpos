"use client";
/**
 * Reparto: repartidores del negocio (Configuración → Reparto) y el mensaje
 * de WhatsApp que se les manda con cada pedido a domicilio: qué lleva, el
 * total, si ya está pagado o cuánto cobrar, y la dirección con su liga de
 * Google Maps. Se manda gratis abriendo WhatsApp con el mensaje listo.
 */
import { whatsappNumber } from "@/lib/digital-menu";

export type Driver = { id: string; name: string; phone: string; active: boolean };

export const DRIVERS_KEY = "bpos_drivers";
export const DRIVERS_EVENT = "bpos:drivers-updated";

export function getDrivers(): Driver[] {
  try {
    const list = JSON.parse(localStorage.getItem(DRIVERS_KEY) || "[]");
    return Array.isArray(list)
      ? list
          .filter((d) => d && typeof d.id === "string")
          .map((d) => ({ id: d.id, name: String(d.name || "").slice(0, 40), phone: String(d.phone || "").replace(/\D/g, "").slice(0, 13), active: d.active !== false }))
      : [];
  } catch {
    return [];
  }
}

export function saveDrivers(list: Driver[]) {
  localStorage.setItem(DRIVERS_KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(DRIVERS_EVENT));
}

export type DispatchInfo = {
  /** "Pedido #12" o "Folio 73A8" */
  title: string;
  businessName: string;
  customer: { name: string; phone: string; address: string; reference?: string; mapsUrl?: string };
  lines: { quantity: number; name: string; detail?: string }[];
  total: number;
  /** Cómo quedó el pago */
  payment: { paid: true; method: string } | { paid: false; method: string; amount: number; cashWith?: number };
  note?: string;
};

const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;

export function driverMessage(info: DispatchInfo) {
  const p = info.payment;
  const pay = p.paid
    ? `✅ *YA PAGADO* (${p.method}). No cobres nada.`
    : `💵 *COBRAR ${money(p.amount)}* en ${p.method.toLowerCase()}${p.cashWith && p.cashWith > p.amount ? ` · paga con ${money(p.cashWith)}, lleva *${money(p.cashWith - p.amount)} de cambio*` : ""}`;
  return [
    `🛵 *${info.title} · ${info.businessName}*`,
    "",
    ...info.lines.map((l) => `• ${l.quantity} × ${l.name}${l.detail ? ` (${l.detail})` : ""}`),
    "",
    `Total: *${money(info.total)}*`,
    pay,
    "",
    `👤 ${info.customer.name}${info.customer.phone ? ` · 📱 ${info.customer.phone}` : ""}`,
    `🏠 ${info.customer.address || "Sin dirección"}${info.customer.reference ? ` (${info.customer.reference})` : ""}`,
    info.customer.mapsUrl ? `📍 ${info.customer.mapsUrl}` : "",
    info.note ? `📝 ${info.note}` : "",
  ]
    .filter((l, i, all) => l !== "" || (i > 0 && all[i - 1] !== ""))
    .join("\n")
    .trim();
}

/** Liga de WhatsApp al repartidor con el mensaje listo ("" si su número no es válido). */
export function driverWhatsappLink(driver: Driver, info: DispatchInfo) {
  const number = whatsappNumber(driver.phone);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(driverMessage(info))}` : "";
}

/** Anota en la venta quién la llevó (para saber cuánto repartió cada uno). */
export function assignDriverToSale(saleId: number, driver: Driver) {
  try {
    const orders = JSON.parse(localStorage.getItem("bpos_orders") || "[]") as { id: number }[];
    const next = orders.map((o) => (Number(o.id) === Number(saleId) ? { ...o, driver: { id: driver.id, name: driver.name, at: new Date().toISOString() } } : o));
    localStorage.setItem("bpos_orders", JSON.stringify(next));
    window.dispatchEvent(new Event("bpos:orders-updated"));
  } catch {}
}
