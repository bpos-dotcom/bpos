"use client";
/**
 * Clientes (Entrega 4): se arman solos con las ventas que llevan nombre o
 * teléfono (domicilio, pedidos del menú digital, mostrador con datos). Se
 * agrupan por teléfono (o por nombre si no dejó teléfono). Las notas que
 * escribe el negocio se guardan en "bpos_customers" (todas las sucursales).
 */
import { orderChannel, type ReportOrder } from "@/lib/reports";
import { whatsappNumber } from "@/lib/digital-menu";

export type CustomerNote = { id: string; name: string; notes: string; updatedAt: string };

export type CustomerVisit = {
  id: string;
  createdAt: string;
  total: number;
  channel: string;
  items: string;
  coupon: string;
};

export type Segment = "nuevo" | "frecuente" | "vip" | "dormido" | "ocasional";

export type Customer = {
  key: string;
  name: string;
  phone: string;
  address: string;
  orders: number;
  spent: number;
  average: number;
  firstAt: string;
  lastAt: string;
  favorites: { name: string; quantity: number }[];
  channels: string[];
  coupons: number;
  notes: string;
  segment: Segment;
  visits: CustomerVisit[];
};

const NOTES_KEY = "bpos_customers";
export const CUSTOMERS_EVENT = "bpos:customers-updated";
const DAY = 24 * 60 * 60 * 1000;

export const SEGMENTS: Record<Segment, { label: string; hint: string; cls: string }> = {
  vip: { label: "⭐ VIP", hint: "Los que más gastan (10% de arriba)", cls: "bg-amber-400/20 text-amber-300" },
  frecuente: { label: "🔁 Frecuente", hint: "3 o más pedidos y vino en los últimos 30 días", cls: "bg-emerald-500/20 text-emerald-300" },
  nuevo: { label: "🆕 Nuevo", hint: "Su primer pedido fue en los últimos 30 días", cls: "bg-sky-500/20 text-sky-300" },
  dormido: { label: "😴 Dormido", hint: "Más de 45 días sin pedir: mándale un cupón", cls: "bg-red-500/20 text-red-300" },
  ocasional: { label: "Ocasional", hint: "Pide de vez en cuando", cls: "bg-zinc-800 text-zinc-300" },
};

export function getCustomerNotes(): CustomerNote[] {
  if (typeof window === "undefined") return [];
  try {
    const list = JSON.parse(localStorage.getItem(NOTES_KEY) || "[]");
    return Array.isArray(list) ? (list as CustomerNote[]) : [];
  } catch {
    return [];
  }
}

export function saveCustomerNote(key: string, name: string, notes: string) {
  const list = getCustomerNotes().filter((n) => n.id !== key);
  const next = notes.trim() ? [...list, { id: key, name, notes: notes.trim().slice(0, 500), updatedAt: new Date().toISOString() }] : list;
  localStorage.setItem(NOTES_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(CUSTOMERS_EVENT));
}

/** El nombre del cliente sin la mesa que le agrega el menú digital ("Ana · Mesa 4") */
const cleanName = (name: string) => String(name || "").split(" · ")[0].trim();

/** Teléfono a 10 dígitos (sin lada de país) o "" */
const phoneKey = (phone: string) => {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
};

type SaleLike = ReportOrder & {
  cancelled?: boolean;
  onlineFolio?: string;
  details?: ReportOrder["details"] & { customerPhone?: string; customerAddress?: string; couponCode?: string };
};

export function buildCustomers(orders: SaleLike[], now = Date.now()): Customer[] {
  const notes = new Map(getCustomerNotes().map((n) => [n.id, n]));
  const groups = new Map<string, SaleLike[]>();
  for (const order of orders) {
    if (order.cancelled) continue;
    const name = cleanName(order.details?.customerName || "");
    const phone = phoneKey(order.details?.customerPhone || "");
    if (!phone && name.length < 2) continue;
    const key = phone ? `tel:${phone}` : `nom:${name.toLowerCase()}`;
    groups.set(key, [...(groups.get(key) || []), order]);
  }

  const list: Customer[] = [...groups.entries()].map(([key, sales]) => {
    sales.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = sales[0];
    const products = new Map<string, number>();
    sales.forEach((s) => s.items.forEach((i) => products.set(i.name, (products.get(i.name) || 0) + (Number(i.quantity) || 0))));
    const spent = sales.reduce((sum, s) => sum + (Number(s.total) || 0), 0);
    const note = notes.get(key);
    return {
      key,
      name: note?.name || cleanName(sales.find((s) => cleanName(s.details?.customerName || ""))?.details?.customerName || "") || "Cliente",
      phone: phoneKey(latest.details?.customerPhone || "") || phoneKey(sales.find((s) => phoneKey(s.details?.customerPhone || ""))?.details?.customerPhone || ""),
      address: sales.find((s) => s.details?.customerAddress)?.details?.customerAddress?.split(" · Envío")[0] || "",
      orders: sales.length,
      spent,
      average: spent / sales.length,
      firstAt: sales[sales.length - 1].createdAt,
      lastAt: latest.createdAt,
      favorites: [...products.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, quantity]) => ({ name, quantity })),
      channels: [...new Set(sales.map((s) => orderChannel(s)))],
      coupons: sales.filter((s) => s.details?.couponCode).length,
      notes: note?.notes || "",
      segment: "ocasional" as Segment,
      visits: sales.map((s) => ({
        id: String(s.onlineFolio || s.localOrderNumber || s.id),
        createdAt: s.createdAt,
        total: Number(s.total) || 0,
        channel: orderChannel(s),
        items: s.items.map((i) => `${i.quantity} ${i.name}`).join(", "),
        coupon: s.details?.couponCode || "",
      })),
    };
  });

  // VIP: el 10% que más gasta (con al menos 2 pedidos)
  const bySpent = [...list].sort((a, b) => b.spent - a.spent);
  const vipCut = bySpent[Math.max(0, Math.ceil(list.length * 0.1) - 1)]?.spent ?? Infinity;
  for (const c of list) {
    const sinceLast = now - Date.parse(c.lastAt);
    const sinceFirst = now - Date.parse(c.firstAt);
    c.segment =
      sinceLast > 45 * DAY
        ? "dormido"
        : c.orders >= 2 && c.spent >= vipCut && list.length >= 10
          ? "vip"
          : c.orders >= 3 && sinceLast <= 30 * DAY
            ? "frecuente"
            : sinceFirst <= 30 * DAY
              ? "nuevo"
              : "ocasional";
  }
  return list.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

/** WhatsApp al cliente con un mensaje (ej. un cupón) */
export function customerWhatsapp(customer: Pick<Customer, "phone">, text: string) {
  const phone = whatsappNumber(customer.phone);
  return phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : "";
}
