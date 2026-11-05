"use client";
/**
 * Finanzas (Entrega 4): gastos fijos del mes (renta, luz, sueldos...) y
 * gastos sueltos con fecha, por sucursal. Con las ventas y el costo de lo
 * vendido (recetas) se saca la utilidad real y el punto de equilibrio.
 */

export type FixedExpense = { id: string; name: string; category: string; amount: number };
export type Expense = { id: string; date: string; concept: string; amount: number };

const FIXED_KEY = "bpos_fixed_expenses";
const EXPENSES_KEY = "bpos_expenses";
export const FINANCE_EVENT = "bpos:finance-updated";

export const EXPENSE_CATEGORIES = ["Renta", "Sueldos", "Luz", "Gas", "Agua", "Internet y teléfono", "Publicidad", "Sistemas", "Mantenimiento", "Otro"];

function read<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const list = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(list) ? (list as T[]) : [];
  } catch {
    return [];
  }
}

function write(key: string, list: unknown[]) {
  localStorage.setItem(key, JSON.stringify(list));
  window.dispatchEvent(new Event(FINANCE_EVENT));
}

const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const getFixedExpenses = () => read<FixedExpense>(FIXED_KEY);
export const getExpenses = () => read<Expense>(EXPENSES_KEY);

export function addFixedExpense(name: string, category: string, amount: number) {
  if (!name.trim() || !(amount > 0)) throw new Error("Escribe el gasto y cuánto pagas al mes.");
  write(FIXED_KEY, [...getFixedExpenses(), { id: newId("f"), name: name.trim().slice(0, 60), category, amount }]);
}

export function updateFixedExpense(id: string, amount: number) {
  write(FIXED_KEY, getFixedExpenses().map((e) => (e.id === id ? { ...e, amount: Math.max(0, amount) } : e)));
}

export function removeFixedExpense(id: string) {
  write(FIXED_KEY, getFixedExpenses().filter((e) => e.id !== id));
}

export function addExpense(date: string, concept: string, amount: number) {
  if (!concept.trim() || !(amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Escribe fecha, concepto y monto.");
  write(EXPENSES_KEY, [...getExpenses(), { id: newId("g"), date, concept: concept.trim().slice(0, 80), amount }]);
}

export function removeExpense(id: string) {
  write(EXPENSES_KEY, getExpenses().filter((e) => e.id !== id));
}

/**
 * Punto de equilibrio: lo que hay que vender al mes para cubrir los gastos
 * fijos con lo que deja cada peso vendido (margen bruto). null si todavía
 * no hay margen para calcularlo.
 */
export function breakEven(fixed: number, grossMarginPct: number) {
  if (!(grossMarginPct > 0)) return null;
  return fixed / (grossMarginPct / 100);
}

// ------------------------------------------------------------ otros ingresos (depósitos de delivery)

/**
 * Otros ingresos: lo que de verdad llega a la cuenta y no se cobra en el
 * local (ej. el depósito semanal de DiDi, Uber o Rappi, ya sin comisiones
 * ni impuestos). Las ventas de esas apps no cuentan en Finanzas porque su
 * total no es lo que te pagan; cuenta el depósito.
 *
 * Las apps depositan días después (lo de la semana del lunes 2 al domingo
 * 8 llega el martes 10): `weekOf` dice de qué semana de ventas es (su
 * lunes) y el depósito cuenta en esa semana, repartido en sus días según
 * lo que vendió esa app cada día. Sin `weekOf` cuenta el día del depósito.
 */
export type OtherIncome = { id: string; date: string; source: string; concept: string; amount: number; weekOf?: string };
export const INCOME_SOURCES = ["DiDi", "Uber", "Rappi", "Otro"];
const INCOME_KEY = "bpos_other_income";

export const getOtherIncome = () => read<OtherIncome>(INCOME_KEY);

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function addOtherIncome(date: string, source: string, concept: string, amount: number, weekOf = "") {
  if (!(amount > 0) || !YMD.test(date)) throw new Error("Escribe la fecha y cuánto te depositaron.");
  const entry: OtherIncome = { id: newId("i"), date, source, concept: concept.trim().slice(0, 80), amount };
  if (YMD.test(weekOf)) entry.weekOf = weekOf;
  write(INCOME_KEY, [...getOtherIncome(), entry]);
}

/** Corregir un depósito (monto, semana a la que corresponde, fecha) */
export function updateOtherIncome(id: string, patch: Partial<Pick<OtherIncome, "amount" | "weekOf" | "date">>) {
  write(
    INCOME_KEY,
    getOtherIncome().map((e) => {
      if (e.id !== id) return e;
      const next = { ...e, ...patch };
      if (patch.amount !== undefined) next.amount = Math.max(0, Number(patch.amount) || 0);
      if (!next.weekOf || !YMD.test(next.weekOf)) delete next.weekOf;
      if (!YMD.test(next.date)) next.date = e.date;
      return next;
    })
  );
}

export function removeOtherIncome(id: string) {
  write(INCOME_KEY, getOtherIncome().filter((e) => e.id !== id));
}

/** ¿Este pedido de plataforma es de esa app? ("Uber Eats" ↔ "Uber") */
const fromApp = (o: { externalPlatform?: string; details?: { orderType?: string } }, source: string) =>
  `${o.externalPlatform || ""} ${o.details?.orderType || ""}`.toLowerCase().includes(source.toLowerCase());

/**
 * Cuánto de los otros ingresos le toca a cada día ("2026-11-03" → $).
 * Un depósito con semana se reparte en sus 7 días según lo que vendió esa
 * app cada día (si no vendió nada registrado, parejo); sin semana, todo al
 * día del depósito.
 */
export function incomeByDay(
  income: OtherIncome[],
  orders: { createdAt: string; total: number; source?: string; externalPlatform?: string; details?: { orderType?: string }; cancelled?: boolean }[]
) {
  const out = new Map<string, number>();
  const add = (key: string, v: number) => out.set(key, (out.get(key) || 0) + v);
  const platform = orders.filter((o) => isPlatformOrder(o) && !o.cancelled);
  for (const i of income) {
    const amount = Number(i.amount) || 0;
    if (!amount) continue;
    if (!i.weekOf) {
      add(i.date, amount);
      continue;
    }
    const days = Array.from({ length: 7 }, (_, k) => ymd(plusDays(parseYmd(i.weekOf!), k)));
    const weight = days.map((d) => platform.filter((o) => fromApp(o, i.source) && ymd(new Date(o.createdAt)) === d).reduce((s, o) => s + (Number(o.total) || 0), 0));
    const sum = weight.reduce((s, w) => s + w, 0);
    days.forEach((d, k) => add(d, sum > 0 ? (amount * weight[k]) / sum : amount / 7));
  }
  return out;
}

/** Lunes de la semana de una fecha "YYYY-MM-DD" */
export const weekStart = (date: string | Date) => ymd(monday(typeof date === "string" ? parseYmd(date) : date));

/** "2 al 8 nov" */
export function weekLabel(mondayYmd: string) {
  const a = parseYmd(mondayYmd);
  const b = plusDays(a, 6);
  const month = (d: Date) => d.toLocaleDateString("es-MX", { month: "short" }).replace(".", "");
  return a.getMonth() === b.getMonth() ? `${a.getDate()} al ${b.getDate()} ${month(b)}` : `${a.getDate()} ${month(a)} al ${b.getDate()} ${month(b)}`;
}

/** Las últimas semanas (lunes), de la actual hacia atrás */
export function recentWeeks(count = 10, now = new Date()) {
  return Array.from({ length: count }, (_, k) => ymd(plusDays(monday(now), -7 * k)));
}

/** Pedido de DiDi, Uber o Rappi (entró por el Bridge) */
export const isPlatformOrder = (o: { source?: string; externalPlatform?: string }) => o.source === "B-POS Bridge" || Boolean(o.externalPlatform);

// ------------------------------------------------------------ periodos

export type FinancePeriod = "semana" | "semana-pasada" | "mes" | "mes-pasado" | "rango";
export const FINANCE_PERIODS: [FinancePeriod, string][] = [
  ["semana-pasada", "Semana pasada"],
  ["semana", "Esta semana"],
  ["mes-pasado", "Mes pasado"],
  ["mes", "Este mes"],
  ["rango", "Rango personalizado"],
];

export type Range = { from: Date; to: Date }; // to = exclusivo

const day0 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const plusDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** La semana empieza en lunes */
const monday = (d: Date) => plusDays(day0(d), -((d.getDay() + 6) % 7));
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const parseYmd = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** Días del periodo (completos, aunque sea el actual) */
export function periodDays(r: Range) {
  return Math.max(1, Math.round((day0(r.to).getTime() - day0(r.from).getTime()) / 86_400_000));
}

/**
 * El periodo y el de antes para comparar: esta semana contra la pasada,
 * este mes contra el pasado; un rango contra los mismos días justo antes.
 * Semanas y meses van completos (lo que falta del actual se ve vacío).
 */
export function financeRanges(period: FinancePeriod, custom: { from: string; to: string }, now = new Date()): { main: Range; previous: Range } {
  const today = day0(now);
  if (period === "semana" || period === "semana-pasada") {
    const start = period === "semana" ? monday(today) : plusDays(monday(today), -7);
    return { main: { from: start, to: plusDays(start, 7) }, previous: { from: plusDays(start, -7), to: start } };
  }
  if (period === "mes" || period === "mes-pasado") {
    const start = new Date(today.getFullYear(), today.getMonth() - (period === "mes" ? 0 : 1), 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return { main: { from: start, to: end }, previous: { from: new Date(start.getFullYear(), start.getMonth() - 1, 1), to: start } };
  }
  let from = /^\d{4}-\d{2}-\d{2}$/.test(custom.from) ? parseYmd(custom.from) : plusDays(today, -13);
  let to = /^\d{4}-\d{2}-\d{2}$/.test(custom.to) ? plusDays(parseYmd(custom.to), 1) : plusDays(today, 1);
  if (to <= from) [from, to] = [plusDays(to, -1), plusDays(from, 1)];
  if (periodDays({ from, to }) > 400) from = plusDays(to, -400);
  const days = periodDays({ from, to });
  return { main: { from, to }, previous: { from: plusDays(from, -days), to: from } };
}

/** Días ya transcurridos del periodo (hasta hoy, incluido); el periodo completo si ya pasó */
export function elapsedDays(r: Range, now = new Date()) {
  const end = Math.min(day0(r.to).getTime(), plusDays(day0(now), 1).getTime());
  return Math.max(0, Math.round((end - day0(r.from).getTime()) / 86_400_000));
}

/** Parte de los gastos fijos (que son por mes) que toca a cada día: el fijo entre los días de su mes */
export function fixedForDay(fixedMonthly: number, d: Date) {
  return fixedMonthly / new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/** Gastos fijos que tocan al periodo (un mes completo = el fijo del mes; una semana, su parte) */
export function fixedForRange(fixedMonthly: number, r: Range) {
  let total = 0;
  for (let d = day0(r.from); d < r.to; d = plusDays(d, 1)) total += fixedForDay(fixedMonthly, d);
  return total;
}

/** Los días del periodo, como fechas */
export function rangeDays(r: Range) {
  const out: Date[] = [];
  for (let d = day0(r.from); d < r.to && out.length < 401; d = plusDays(d, 1)) out.push(d);
  return out;
}
