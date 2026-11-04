"use client";
/**
 * Reportes por empleado y reparto de propinas.
 *
 * Todo se calcula en el equipo con lo que B-POS ya guarda (ventas, checador
 * y bitácora): no hace consultas nuevas a la nube. Lo único que se guarda es
 * cada reparto de propinas que alguien confirma (bpos_tip_payouts, por
 * sucursal), un registro chico por reparto.
 *
 * ¿De quién es una venta? Del mesero si la tomó en la app de meseros; si no,
 * de quien la capturó en el POS. Ventas viejas (antes de guardar quién la
 * hizo) se buscan en la bitácora de este equipo.
 */
import { getAuditLog } from "@/lib/audit";
import { tipOf } from "@/lib/sale-payments";
import { getPunches, workDays } from "@/lib/timeclock";
import type { DateRange, ReportOrder } from "@/lib/reports";

export const NO_EMPLOYEE = "Sin registrar";
export const TIP_PAYOUTS_KEY = "bpos_tip_payouts";
export const TIP_PAYOUTS_EVENT = "bpos:tip-payouts-updated";

type StaffSale = ReportOrder & {
  soldBy?: string;
  paidBy?: string;
  tip?: number;
  tipPayments?: Record<string, number>;
  details?: ReportOrder["details"] & { waiter?: string };
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Pedido → quién lo creó, según la bitácora (para ventas de antes de guardar soldBy) */
export function auditSellerIndex(): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of getAuditLog()) {
    if (e.action === "sale.created" && e.entityId && e.userName && !map.has(e.entityId)) map.set(e.entityId, e.userName);
  }
  return map;
}

/** El empleado al que se le cuenta la venta */
export function saleEmployee(order: StaffSale, audit?: Map<string, string>): string {
  return (order.details?.waiter || order.soldBy || audit?.get(String(order.id)) || NO_EMPLOYEE).trim() || NO_EMPLOYEE;
}

/** Ventas de plataformas (DiDi, Uber, Rappi) no son de un empleado */
const isPlatform = (o: StaffSale) => Boolean(o.externalPlatform);

export type StaffRow = { name: string; orders: number; sales: number; average: number; tips: number; items: number; hours: number; shifts: number };

/** Horas trabajadas por nombre en el periodo (del checador) */
export function hoursByEmployee(range: DateRange, now = Date.now()): Map<string, { hours: number; shifts: number }> {
  const out = new Map<string, { hours: number; shifts: number }>();
  for (const d of workDays(getPunches(), range.from, new Date(range.to.getTime() - 1), now)) {
    const cur = out.get(d.userName) || { hours: 0, shifts: 0 };
    cur.hours += d.hours;
    if (d.hours > 0) cur.shifts += 1;
    out.set(d.userName, cur);
  }
  return out;
}

/**
 * Ventas, ticket promedio, propinas y horas por empleado. `orders` ya viene
 * filtrado por periodo y sin canceladas (ReportData.orders).
 */
export function staffReport(orders: ReportOrder[], range: DateRange, audit = auditSellerIndex()): StaffRow[] {
  const rows = new Map<string, StaffRow>();
  const row = (name: string) => {
    let r = rows.get(name);
    if (!r) rows.set(name, (r = { name, orders: 0, sales: 0, average: 0, tips: 0, items: 0, hours: 0, shifts: 0 }));
    return r;
  };
  for (const o of orders as StaffSale[]) {
    if (isPlatform(o)) continue;
    const r = row(saleEmployee(o, audit));
    r.orders += 1;
    r.sales += Number(o.total) || 0;
    r.tips += tipOf({ total: o.total, tip: o.tip, details: { paymentMethod: o.details?.paymentMethod } });
    r.items += (o.items || []).reduce((s, i) => s + (Number(i.quantity) || 0), 0);
  }
  for (const [name, h] of hoursByEmployee(range)) {
    const r = row(name);
    r.hours = h.hours;
    r.shifts = h.shifts;
  }
  return [...rows.values()]
    .map((r) => ({ ...r, sales: round2(r.sales), tips: round2(r.tips), average: r.orders ? round2(r.sales / r.orders) : 0, hours: Math.round(r.hours * 100) / 100 }))
    .sort((a, b) => (a.name === NO_EMPLOYEE ? 1 : b.name === NO_EMPLOYEE ? -1 : b.sales - a.sales || b.hours - a.hours));
}

// ------------------------------------------------------------ productos

export type SlowRow = { name: string; category: string; quantity: number; sales: number };

/**
 * Productos del catálogo que menos se vendieron en el periodo (incluye los
 * que no se vendieron nada). Solo los que se venden solos (no partes de combo).
 */
export function slowMovers(
  products: { id: number; name: string; category?: string; notSoldAlone?: boolean }[],
  sold: { label: string; quantity: number; sales: number }[],
  limit = 15
): SlowRow[] {
  const byName = new Map(sold.map((r) => [r.label, r]));
  return products
    .filter((p) => !p.notSoldAlone && p.name)
    .map((p) => ({ name: p.name, category: p.category || "Sin categoría", quantity: byName.get(p.name)?.quantity || 0, sales: byName.get(p.name)?.sales || 0 }))
    .sort((a, b) => a.quantity - b.quantity || a.sales - b.sales || a.name.localeCompare(b.name, "es"))
    .slice(0, limit);
}

export type ModifierRow = { group: string; name: string; times: number; sales: number };

/** Extras y opciones más pedidos (salsas, términos, extras con cobro) */
export function modifierPopularity(orders: ReportOrder[], limit = 25): ModifierRow[] {
  const map = new Map<string, ModifierRow>();
  const add = (group: string, name: string, times: number, price: number) => {
    const g = String(group || "Opciones").trim();
    const n = String(name || "").trim();
    if (!n || /^no[, ]/i.test(n)) return; // "No, gracias" no es una preferencia
    const key = `${g}\u0000${n}`;
    const cur = map.get(key) || { group: g, name: n, times: 0, sales: 0 };
    cur.times += times;
    cur.sales += price * times;
    map.set(key, cur);
  };
  for (const o of orders as StaffSale[]) {
    for (const item of o.items || []) {
      const qty = Number(item.quantity) || 0;
      item.modifiers?.forEach((m) => {
        if (m.extra) return; // renglón de cobro (ya se cuentan las opciones sueltas)
        add(m.group, m.name, qty, Number(m.price) || 0);
      });
      item.parts?.forEach((part) => part.modifiers?.forEach((m) => !m.extra && add(m.group, m.name, qty * (Number(part.quantity) || 1), Number(m.price) || 0)));
    }
  }
  return [...map.values()]
    .map((r) => ({ ...r, sales: round2(r.sales) }))
    .sort((a, b) => b.times - a.times)
    .slice(0, limit);
}

// ------------------------------------------------------------ reparto de propinas

export type TipMode = "directas" | "igual" | "horas" | "puntos";

export const TIP_MODES: Record<TipMode, { label: string; hint: string }> = {
  directas: { label: "Cada quien la suya", hint: "Cada empleado se queda con las propinas de las ventas que atendió." },
  igual: { label: "Todos por igual", hint: "Se juntan todas las propinas y se reparten en partes iguales." },
  horas: { label: "Por horas trabajadas", hint: "Se juntan y se reparten según las horas del checador en el periodo." },
  puntos: { label: "Por puntos", hint: "Se juntan y se reparten según los puntos que le des a cada quien (ej. mesero 3, cocina 2, lavaloza 1)." },
};

export type TipPerson = { name: string; tips: number; hours: number; points: number };
export type TipLine = { name: string; amount: number; tips: number; hours: number; points: number };

/** Reparte las propinas según el modo. Centavos exactos: lo que sobra del redondeo va al primero. */
export function splitTips(mode: TipMode, people: TipPerson[]): { total: number; lines: TipLine[]; problem: string } {
  const total = round2(people.reduce((s, p) => s + p.tips, 0));
  const weight = (p: TipPerson) => (mode === "igual" ? 1 : mode === "horas" ? Math.max(0, p.hours) : mode === "puntos" ? Math.max(0, p.points) : Math.max(0, p.tips));
  const sum = people.reduce((s, p) => s + weight(p), 0);
  if (!people.length) return { total, lines: [], problem: "Elige quién entra al reparto." };
  if (mode === "directas") {
    return { total, lines: people.map((p) => ({ name: p.name, amount: round2(p.tips), tips: p.tips, hours: p.hours, points: p.points })), problem: "" };
  }
  if (sum <= 0) {
    const why = mode === "horas" ? "Nadie de los elegidos tiene horas en el checador en este periodo." : "Ponle puntos a cada quien.";
    return { total, lines: people.map((p) => ({ name: p.name, amount: 0, tips: p.tips, hours: p.hours, points: p.points })), problem: why };
  }
  const lines = people.map((p) => ({ name: p.name, amount: Math.floor(((total * weight(p)) / sum) * 100) / 100, tips: p.tips, hours: p.hours, points: p.points }));
  const left = round2(total - lines.reduce((s, l) => s + l.amount, 0));
  if (left !== 0) {
    const top = lines.reduce((best, l, i) => (weight(people[i]) > weight(people[best]) ? i : best), 0);
    lines[top].amount = round2(lines[top].amount + left);
  }
  return { total, lines, problem: "" };
}

export type TipPayout = {
  id: string;
  createdAt: string;
  createdBy: string;
  from: string;
  to: string;
  mode: TipMode;
  total: number;
  notes: string;
  lines: TipLine[];
};

export function getTipPayouts(): TipPayout[] {
  try {
    const list = JSON.parse(localStorage.getItem(TIP_PAYOUTS_KEY) || "[]");
    return Array.isArray(list) ? (list as TipPayout[]).filter((p) => p && typeof p.id === "string").sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];
  } catch {
    return [];
  }
}

export function saveTipPayout(payout: Omit<TipPayout, "id" | "createdAt">): TipPayout {
  const saved: TipPayout = { ...payout, notes: payout.notes.trim().slice(0, 500), id: `tips-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, createdAt: new Date().toISOString() };
  localStorage.setItem(TIP_PAYOUTS_KEY, JSON.stringify([saved, ...getTipPayouts()].slice(0, 500)));
  window.dispatchEvent(new Event(TIP_PAYOUTS_EVENT));
  return saved;
}
