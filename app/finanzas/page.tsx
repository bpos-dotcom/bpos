"use client";
/**
 * Finanzas (Entrega 4): con las ventas del local, los depósitos de las apps
 * de delivery, el costo de lo vendido (recetas y compras), los gastos fijos
 * y los gastos sueltos, B-POS dice cuánto ganas de verdad, tu food cost y
 * cuánto tienes que vender para no perder (punto de equilibrio).
 *
 * Las ventas de DiDi, Uber y Rappi (Bridge) NO cuentan como ingreso: su
 * total no es lo que te pagan. Cuenta el depósito que registras en "Otros
 * ingresos". Su costo (la comida) sí cuenta, porque sí salió de tu cocina.
 * Mientras una semana de una app no tiene su depósito real, cuenta el
 * depósito ESTIMADO (lo vendido menos las comisiones de ⚙️ Comisiones de
 * apps) y la utilidad y el punto de equilibrio dicen "estimado"; con todos
 * los depósitos reales, "real ✓".
 *
 * Compras: no se restan de la utilidad (ahí cuenta el costo de lo vendido,
 * con recetas), pero se muestran como dinero que salió, en la semana de
 * ingresos con que se pagaron (Compras → "Se pagó con los ingresos de").
 */
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { FinanceChart, type ChartSeries } from "@/components/finance/FinanceChart";
import { AppsPanel } from "@/components/finance/AppsPanel";
import {
  EXPENSE_CATEGORIES,
  FINANCE_EVENT,
  FINANCE_PERIODS,
  INCOME_SOURCES,
  addExpense,
  addFixedExpense,
  addOtherIncome,
  breakEven,
  elapsedDays,
  financeRanges,
  fixedForDay,
  fixedForRange,
  getExpenses,
  getFixedExpenses,
  getOtherIncome,
  incomeByDay,
  isPlatformOrder,
  recentWeeks,
  updateOtherIncome,
  weekLabel,
  weekStart,
  periodDays,
  rangeDays,
  removeExpense,
  removeFixedExpense,
  removeOtherIncome,
  updateFixedExpense,
  ymd,
  type Expense,
  type FinancePeriod,
  type FixedExpense,
  type OtherIncome,
  type Range,
} from "@/lib/finance";
import { buildReport, loadReportSources, type ReportSources } from "@/lib/reports";
import { paymentsOf, type PaidSale } from "@/lib/sale-payments";
import { COMMISSIONS_EVENT, DELIVERY_APPS, deliveryApp, getAppCommissions, isConfigured, netFactor, saveAppCommissions, type AppCommission } from "@/lib/app-commissions";

/** Orden en que se muestran las formas de pago; las demás van después */
const PAY_ORDER = ["Efectivo", "Tarjeta", "Transferencia", "Mercado Pago"];

const card = "rounded-3xl border border-zinc-800 bg-zinc-950 p-5";
const input = "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white";
const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const pct = (n: number) => `${(Number.isFinite(n) ? n : 0).toFixed(1)}%`;
const DAY = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const DAY_FULL = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const WEEKDAY_PLURAL = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"];
const parseYmdLocal = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const shortDay = (d: Date) => d.toLocaleDateString("es-MX", { day: "numeric", month: "short" }).replace(".", "");

/** Anillo de avance hacia el punto de equilibrio (naranja; verde al cubrirlo) */
function ProgressRing({ value }: { value: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  const done = v >= 100;
  return (
    <svg viewBox="0 0 140 140" className="my-3 h-36 w-36" role="img" aria-label={`Llevas ${v.toFixed(1)}% del punto de equilibrio`}>
      <circle cx="70" cy="70" r={r} fill="none" strokeWidth="10" style={{ stroke: "var(--color-zinc-800)" }} />
      <circle
        cx="70"
        cy="70"
        r={r}
        fill="none"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${(v / 100) * c} ${c}`}
        transform="rotate(-90 70 70)"
        style={{ stroke: done ? "var(--color-emerald-500)" : "var(--color-orange-500)" }}
      />
      <text x="70" y="78" textAnchor="middle" fontSize="24" fontWeight="900" style={{ fill: done ? "var(--color-emerald-400)" : "var(--color-orange-500)" }}>
        {v.toFixed(1)}%
      </text>
    </svg>
  );
}

function Kpi({ title, value, hint, tone = "" }: { title: string; value: string; hint?: React.ReactNode; tone?: string }) {
  return (
    <div className={card}>
      <p className="text-sm text-zinc-400">{title}</p>
      <p className={`text-3xl font-black ${tone}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

/** "Uber Eats" → "Uber", "DiDi Food" → "DiDi" (como en los depósitos) */
const appName = (o: { externalPlatform?: string; details?: { orderType?: string } }) => {
  const raw = `${o.externalPlatform || o.details?.orderType || ""}`;
  const low = raw.toLowerCase();
  return low.includes("uber") ? "Uber" : low.includes("didi") ? "DiDi" : low.includes("rappi") ? "Rappi" : raw || "Otra app";
};

type AppRow = { name: string; orders: number; sales: number; ticket: number; deposited: number };

/** Pedidos, venta (precio al cliente), ticket promedio y lo depositado por app, de más a menos pedidos */
function appBreakdown(platform: ReportSources["orders"], deposits: OtherIncome[]): AppRow[] {
  const map = new Map<string, AppRow>();
  for (const o of platform) {
    const name = appName(o as Parameters<typeof appName>[0]);
    const row = map.get(name) || { name, orders: 0, sales: 0, ticket: 0, deposited: 0 };
    row.orders += 1;
    row.sales += Number(o.total) || 0;
    map.set(name, row);
  }
  for (const d of deposits) {
    const row = map.get(d.source);
    if (row) row.deposited += Number(d.amount) || 0;
  }
  return [...map.values()].map((r) => ({ ...r, ticket: r.orders ? r.sales / r.orders : 0 })).sort((a, b) => b.orders - a.orders || b.sales - a.sales);
}

/** Todo lo de un periodo: ingresos (local + depósitos), costo, gastos y su avance día por día */
function periodNumbers(src: ReportSources, range: Range, income: OtherIncome[], incomeDays: Map<string, number>, appIncomeDays: Map<string, number>, fixedMonthly: number, expenses: Expense[], commissions: Record<string, AppCommission>) {
  const local = buildReport({ ...src, orders: src.orders.filter((o) => !isPlatformOrder(o)) }, range);
  const all = buildReport(src, range);
  const from = ymd(range.from);
  const to = ymd(range.to);
  const inRange = (date: string) => date >= from && date < to;
  // Depósito estimado: ventas de cada app en semanas que todavía no tienen su depósito real
  const covered = new Set(income.map((i) => `${i.source}|${i.weekOf || weekStart(i.date)}`));
  const estimateByDay = new Map<string, number>();
  const estimateByApp = new Map<string, number>();
  const pendingApps = new Set<string>();
  const unconfigured = new Set<string>();
  for (const o of all.orders.filter((x) => isPlatformOrder(x))) {
    const app = deliveryApp(o as Parameters<typeof deliveryApp>[0]);
    const day = ymd(new Date(o.createdAt));
    if (covered.has(`${app}|${weekStart(day)}`)) continue;
    pendingApps.add(app);
    const c = commissions[app];
    if (!isConfigured(c)) {
      unconfigured.add(app);
      continue;
    }
    const est = (Number(o.total) || 0) * netFactor(c);
    estimateByDay.set(day, (estimateByDay.get(day) || 0) + est);
    estimateByApp.set(app, (estimateByApp.get(app) || 0) + est);
  }
  // Un depósito con semana cuenta en esa semana (aunque haya caído después)
  const deposits = income.filter((i) => (i.weekOf ? i.weekOf < to && ymd(new Date(parseYmdLocal(i.weekOf).getTime() + 6 * 86_400_000)) >= from : inRange(i.date)));
  const extras = expenses.filter((e) => inRange(e.date));
  // Caja (cortes no anulados): el faltante o sobrante de cada corte cuenta el día del corte, y los
  // gastos pagados con dinero de la caja (movimiento "Gasto") el día que se hicieron. El fondo no cuenta.
  const cuts = src.shifts.filter((c) => !c.voided && c.closedAt && inRange(ymd(new Date(c.closedAt))));
  const cashDiffByDay = new Map<string, number>();
  cuts.forEach((c) => cashDiffByDay.set(ymd(new Date(c.closedAt)), (cashDiffByDay.get(ymd(new Date(c.closedAt))) || 0) + (Number(c.difference) || 0)));
  const cashSpentByDay = new Map<string, number>();
  src.shifts
    .filter((c) => !c.voided)
    .flatMap((c) => c.movements || [])
    .filter((m) => m.type === "Gasto" && inRange(ymd(new Date(m.createdAt))))
    .forEach((m) => cashSpentByDay.set(ymd(new Date(m.createdAt)), (cashSpentByDay.get(ymd(new Date(m.createdAt))) || 0) + (Number(m.amount) || 0)));
  const localByDay = new Map(local.byDay.map((r) => [r.label, r.sales]));
  // Con qué se pagó lo vendido cada día (efectivo, tarjeta, transferencia...), aunque sea pago mixto
  const payByDay = new Map<string, Record<string, number>>();
  for (const o of local.orders) {
    const key = ymd(new Date(o.createdAt));
    const day = payByDay.get(key) || {};
    for (const [method, amount] of Object.entries(paymentsOf(o as unknown as PaidSale))) day[method] = (day[method] || 0) + amount;
    payByDay.set(key, day);
  }
  const costByDay = new Map(all.byDay.map((r) => [r.label, r.cost]));
  const days = rangeDays(range).map((d) => {
    const key = ymd(d);
    const inc = (localByDay.get(key) || 0) + (incomeDays.get(key) || 0) + (estimateByDay.get(key) || 0);
    const spent =
      (costByDay.get(key) || 0) +
      fixedForDay(fixedMonthly, d) +
      extras.filter((e) => e.date === key).reduce((s, e) => s + e.amount, 0) +
      (cashSpentByDay.get(key) || 0) -
      (cashDiffByDay.get(key) || 0);
    const pays = payByDay.get(key) || {};
    const deposit = appIncomeDays.get(key) || 0;
    const estimate = estimateByDay.get(key) || 0;
    // Locales: lo vendido en el local y otros ingresos que no son de apps; apps: depósitos y estimados
    const apps = deposit + estimate;
    const other = (incomeDays.get(key) || 0) - deposit;
    const localBreakdown = [
      ...Object.entries(pays).sort((a, b) => (PAY_ORDER.indexOf(a[0]) + 1 || 99) - (PAY_ORDER.indexOf(b[0]) + 1 || 99)).map(([label, amount]) => ({ label, amount })),
      ...(other > 0.5 ? [{ label: "Otros ingresos", amount: other }] : []),
    ];
    const appsBreakdown = [...(deposit > 0.5 ? [{ label: "Depósitos", amount: deposit }] : []), ...(estimate > 0.5 ? [{ label: "Estimado", amount: estimate }] : [])];
    return { date: d, key, income: inc, local: inc - apps, apps, profit: inc - spent, localBreakdown, appsBreakdown };
  });
  const platform = all.orders.filter((o) => isPlatformOrder(o));
  // Compras: cuentan en la semana de ingresos con que se pagaron (si no se eligió, el día de la compra)
  const paidOn = (p: ReportSources["purchases"][number]) => p.paidWeekOf || ymd(new Date(p.createdAt));
  const confirmed = src.purchases.filter((p) => p.status !== "cancelled");
  const purchases = confirmed.filter((p) => inRange(paidOn(p)));
  // Compradas en estos días pero pagadas con ingresos de otra semana
  const paidElsewhere = confirmed.filter((p) => inRange(ymd(new Date(p.createdAt))) && !inRange(paidOn(p)));
  const bySupplier = new Map<string, number>();
  purchases.forEach((p) => bySupplier.set(p.supplier || "Sin proveedor", (bySupplier.get(p.supplier || "Sin proveedor") || 0) + p.total));
  return {
    local,
    all,
    localSales: local.kpis.sales,
    depositTotal: rangeDays(range).reduce((s, d) => s + (incomeDays.get(ymd(d)) || 0), 0),
    /** Depósito estimado de las semanas sin depósito real (por app) */
    estimateTotal: [...estimateByApp.values()].reduce((s, v) => s + v, 0),
    estimateByApp: [...estimateByApp.entries()],
    /** Apps con ventas sin depósito real en el periodo (si hay, la utilidad es estimada) */
    pendingApps: [...pendingApps],
    unconfiguredApps: [...unconfigured],
    deposits,
    extras,
    extraTotal: extras.reduce((s, e) => s + e.amount, 0),
    /** Suma de faltantes (−) y sobrantes (+) de los cortes del periodo */
    cashDiff: [...cashDiffByDay.values()].reduce((s, v) => s + v, 0),
    cashSpent: [...cashSpentByDay.values()].reduce((s, v) => s + v, 0),
    cutsWithDiff: cuts.filter((c) => Math.abs(Number(c.difference) || 0) >= 0.01).map((c) => ({ folio: c.folio, closedAt: c.closedAt, difference: Number(c.difference) || 0, reason: c.differenceReason || "" })),
    fixed: fixedForRange(fixedMonthly, range),
    cost: all.kpis.cost,
    platformSales: platform.reduce((s, o) => s + (Number(o.total) || 0), 0),
    platformOrders: platform.length,
    byApp: appBreakdown(platform, deposits),
    purchases,
    purchaseTotal: purchases.reduce((s, p) => s + p.total, 0),
    purchaseSuppliers: [...bySupplier.entries()].sort((a, b) => b[1] - a[1]),
    paidElsewhere,
    costByIngredient: all.costByIngredient,
    days,
  };
}

export default function FinanzasPage() {
  const [period, setPeriod] = useState<FinancePeriod>("mes");
  const [custom, setCustom] = useState(() => {
    const d = new Date();
    return { from: ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 13)), to: ymd(d) };
  });
  const [chartMetric, setChartMetric] = useState<"ingresos" | "utilidad">("ingresos");
  const [fixed, setFixed] = useState<FixedExpense[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [income, setIncome] = useState<OtherIncome[]>([]);
  const [commissions, setCommissions] = useState<Record<string, AppCommission>>({});
  const [commissionsOpen, setCommissionsOpen] = useState(false);
  const [src, setSrc] = useState<ReportSources | null>(null);
  const [form, setForm] = useState({ name: "", category: "Renta", amount: "" });
  const [extra, setExtra] = useState({ date: ymd(new Date()), concept: "", amount: "" });
  const [deposit, setDeposit] = useState({ date: ymd(new Date()), source: "DiDi", concept: "", amount: "", weekOf: "" });
  const [error, setError] = useState("");
  const [whyOpen, setWhyOpen] = useState(false);

  useEffect(() => {
    const load = () => {
      setFixed(getFixedExpenses());
      setExpenses(getExpenses());
      setIncome(getOtherIncome());
      setCommissions(getAppCommissions());
      setSrc(loadReportSources());
    };
    load();
    window.addEventListener(FINANCE_EVENT, load);
    window.addEventListener(COMMISSIONS_EVENT, load);
    window.addEventListener("bpos:orders-updated", load);
    return () => {
      window.removeEventListener(FINANCE_EVENT, load);
      window.removeEventListener(COMMISSIONS_EVENT, load);
      window.removeEventListener("bpos:orders-updated", load);
    };
  }, []);

  const ranges = useMemo(() => financeRanges(period, custom), [period, custom]);
  const fixedTotal = fixed.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const data = useMemo(
    () => {
      if (!src) return null;
      const orders = src.orders as Parameters<typeof incomeByDay>[1];
      const days = incomeByDay(income, orders);
      const appDays = incomeByDay(income.filter((i) => i.source !== "Otro"), orders);
      return {
        cur: periodNumbers(src, ranges.main, income, days, appDays, fixedTotal, expenses, commissions),
        prev: periodNumbers(src, ranges.previous, income, days, appDays, fixedTotal, expenses, commissions),
      };
    },
    [src, ranges, income, fixedTotal, expenses, commissions]
  );

  const cur = data?.cur;
  const range = ranges.main;
  const totalDays = periodDays(range);
  const elapsed = elapsedDays(range);
  const isCurrent = elapsed > 0 && elapsed < totalDays;
  const daysSoFar = Math.max(1, isCurrent ? elapsed : totalDays);
  const sales = (cur?.localSales || 0) + (cur?.depositTotal || 0) + (cur?.estimateTotal || 0);
  // Estimado: hay ventas de apps sin su depósito real; real: todas las semanas ya tienen depósito
  const estimated = (cur?.pendingApps.length || 0) > 0;
  const hasApps = (cur?.platformOrders || 0) > 0;
  const status = estimated ? " (estimado)" : hasApps ? " real ✓" : "";
  const cost = cur?.cost || 0;
  const gross = sales - cost;
  const grossMargin = sales > 0 ? (gross / sales) * 100 : 0;
  const foodCost = sales > 0 ? (cost / sales) * 100 : 0;
  // Los fijos son por mes: al periodo le toca su parte (completa aunque el periodo vaya a la mitad)
  const fixedPeriod = cur?.fixed || 0;
  const extraTotal = cur?.extraTotal || 0;
  const cashSpent = cur?.cashSpent || 0;
  const cashDiff = cur?.cashDiff || 0;
  const expensesTotal = fixedPeriod + extraTotal + cashSpent;
  // Lo que hay que cubrir: los gastos, más lo que faltó en caja (o menos lo que sobró)
  const toCover = expensesTotal - cashDiff;
  const net = gross - toCover;
  const netMargin = sales > 0 ? (net / sales) * 100 : 0;
  const equilibrium = breakEven(Math.max(0, toCover), grossMargin);
  const dailyNeeded = equilibrium ? equilibrium / totalDays : 0;
  const projection = isCurrent ? (sales / daysSoFar) * totalDays : sales;
  const projectedNet = isCurrent ? (projection * grossMargin) / 100 - toCover : net;
  const progress = equilibrium ? Math.min(100, (sales / equilibrium) * 100) : 0;
  // Día del periodo en que (al ritmo actual) ya se cubren los gastos
  const coverDay = equilibrium && sales > 0 ? Math.ceil(equilibrium / (sales / daysSoFar)) : null;
  const periodName = FINANCE_PERIODS.find(([k]) => k === period)?.[1].toLowerCase() || "periodo";
  const word = period === "semana" || period === "semana-pasada" ? "semana" : period === "rango" ? "periodo" : "mes";
  const coverage = cur?.all.kpis.costCoverage ?? 100;

  // Gráfica: acumulado día por día; el periodo anterior en los mismos días
  // Ingresos: locales (verde) y de apps (naranja); utilidad: una sola línea
  const chart = useMemo(() => {
    if (!data) return null;
    type Day = (typeof data.cur.days)[number];
    const n = Math.max(data.cur.days.length, data.prev.days.length);
    const labels = Array.from({ length: n }, (_, i) => {
      const d = data.cur.days[i]?.date;
      if (!d) return `Día ${i + 1}`;
      return period === "semana" || period === "semana-pasada" ? `${DAY[d.getDay()]} ${d.getDate()}` : shortDay(d);
    });
    const upTo = elapsed || data.cur.days.length;
    const prevUpTo = data.prev.days.length;
    const daily = (list: Day[], until: number, pick: (d: Day) => number) => Array.from({ length: n }, (_, i) => (i < until && list[i] ? pick(list[i]) : null));
    const acc = (list: Day[], until: number, pick: (d: Day) => number) => {
      let sum = 0;
      return daily(list, until, pick).map((v) => (v === null ? null : (sum += v)));
    };
    const line = (name: string, color: string, pick: (d: Day) => number, breakdown?: (d: Day) => { label: string; amount: number }[]): ChartSeries => ({
      name,
      color,
      current: acc(data.cur.days, upTo, pick),
      previous: acc(data.prev.days, prevUpTo, pick),
      currentDay: daily(data.cur.days, upTo, pick),
      previousDay: daily(data.prev.days, prevUpTo, pick),
      breakdown: breakdown && Array.from({ length: n }, (_, i) => (i < upTo && data.cur.days[i] ? breakdown(data.cur.days[i]) : null)),
    });
    const series =
      chartMetric === "ingresos"
        ? [line("Locales", "var(--color-emerald-500)", (d) => d.local, (d) => d.localBreakdown), line("Apps", "var(--color-orange-500)", (d) => d.apps, (d) => d.appsBreakdown)]
        : [line("Utilidad", "var(--color-sky-400)", (d) => d.profit)];
    return { labels, series };
  }, [data, chartMetric, elapsed, period]);

  // El mejor día: en semana, el día; en mes (o periodos largos), el día de la semana con mejor promedio
  const bestDay = useMemo(() => {
    if (!data) return null;
    const days = data.cur.days.slice(0, elapsed || data.cur.days.length);
    const value = (d: (typeof days)[number]) => (chartMetric === "ingresos" ? d.income : d.profit);
    if (!days.length || days.every((d) => Math.abs(value(d)) < 0.5)) return null;
    if (word === "semana" || (word === "periodo" && data.cur.days.length <= 7)) {
      const best = days.reduce((a, b) => (value(b) > value(a) ? b : a));
      const when = `${DAY_FULL[best.date.getDay()]} ${best.date.getDate()} de ${best.date.toLocaleDateString("es-MX", { month: "short" }).replace(".", "")}`;
      return { when, amount: value(best), detail: chartMetric === "ingresos" ? `locales ${money(best.local)} · apps ${money(best.apps)}` : "", average: false, count: 1, unit: "" };
    }
    const byWeekday = new Map<number, { total: number; local: number; apps: number; count: number }>();
    days.forEach((d) => {
      const w = byWeekday.get(d.date.getDay()) || { total: 0, local: 0, apps: 0, count: 0 };
      byWeekday.set(d.date.getDay(), { total: w.total + value(d), local: w.local + d.local, apps: w.apps + d.apps, count: w.count + 1 });
    });
    const [weekday, best] = [...byWeekday.entries()].reduce((a, b) => (b[1].total / b[1].count > a[1].total / a[1].count ? b : a));
    return {
      when: `Los ${WEEKDAY_PLURAL[weekday]}`,
      unit: best.count === 1 ? DAY_FULL[weekday].toLowerCase() : WEEKDAY_PLURAL[weekday],
      amount: best.total / best.count,
      detail: chartMetric === "ingresos" ? `locales ${money(best.local / best.count)} · apps ${money(best.apps / best.count)}` : "",
      average: true,
      count: best.count,
    };
  }, [data, chartMetric, elapsed, word]);

  const prevSameDays = useMemo(() => {
    if (!data) return null;
    const upTo = Math.min(daysSoFar, data.prev.days.length);
    const sum = (list: { income: number }[]) => list.slice(0, upTo).reduce((s, d) => s + d.income, 0);
    const now = sum(data.cur.days);
    const before = sum(data.prev.days);
    return { now, before, change: before > 0 ? ((now - before) / before) * 100 : null };
  }, [data, daysSoFar]);

  function run(fn: () => void) {
    setError("");
    try {
      fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo.");
    }
  }

  // Semana de ventas del depósito: la que estás viendo si es una semana; si no, la pasada (lo normal: depositan días después)
  const weekOptions = recentWeeks(12);
  const defaultWeek = period === "semana" || period === "semana-pasada" ? weekStart(ranges.main.from) : weekOptions[1];
  const formWeek = deposit.weekOf || defaultWeek;
  const weekText = (w: string) => `Semana del ${weekLabel(w)}${w === weekOptions[0] ? " (esta)" : w === weekOptions[1] ? " (pasada)" : ""}`;

  const previousName = period === "semana" ? "Semana pasada" : period === "semana-pasada" ? "La semana anterior" : period === "mes" ? "Mes pasado" : period === "mes-pasado" ? "El mes anterior" : "Los días de antes";
  const currentName = FINANCE_PERIODS.find(([k]) => k === period)?.[1] === "Rango personalizado" ? "Tu rango" : FINANCE_PERIODS.find(([k]) => k === period)?.[1] || "";

  return (
    <AppShell title="Finanzas" subtitle="Cuánto ganas de verdad: ventas del local, depósitos de delivery, costo de lo vendido, gastos y punto de equilibrio.">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          {FINANCE_PERIODS.map(([key, text]) => (
            <button key={key} onClick={() => {
                setPeriod(key);
                setDeposit((d) => ({ ...d, weekOf: "" })); // la semana del depósito vuelve a seguir al periodo
              }} className={`rounded-2xl border px-4 py-2 text-sm font-black ${period === key ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-800 text-zinc-300 hover:border-zinc-600"}`}>
              {text}
            </button>
          ))}
          {period === "rango" && (
            <span className="flex flex-wrap items-center gap-2">
              <input type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} className="rounded-2xl border border-zinc-800 bg-black px-3 py-2" aria-label="Desde" />
              <span className="text-zinc-500">a</span>
              <input type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} className="rounded-2xl border border-zinc-800 bg-black px-3 py-2" aria-label="Hasta" />
            </span>
          )}
          <span className="text-xs text-zinc-500">
            {shortDay(range.from)} a {shortDay(new Date(range.to.getTime() - 86_400_000))} · {totalDays} días
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Kpi
            title="Ingresos"
            value={money(sales)}
            hint={
              <>
                Lo vendido en local y menú {money(cur?.localSales || 0)} ({cur?.local.kpis.orders || 0} pedidos) · depósitos de apps {money(cur?.depositTotal || 0)}
                {(cur?.estimateTotal || 0) > 0 ? ` + ${money(cur!.estimateTotal)} estimado` : ""} · el fondo de caja no cuenta
              </>
            }
          />
          <Kpi
            title="Food cost (costo de lo vendido)"
            value={pct(foodCost)}
            hint={`${money(cost)} · incluye la comida de las apps · lo sano es 28% a 35%`}
            tone={foodCost > 35 ? "text-red-400" : foodCost > 0 ? "text-emerald-400" : ""}
          />
          <Kpi title="Utilidad bruta" value={money(gross)} hint={`Margen ${pct(grossMargin)} (ingresos menos costo)`} />
          <Kpi title={`Gastos de ${word === "mes" ? "este mes" : word === "semana" ? "esta semana" : "este periodo"}`} value={money(expensesTotal)} hint={`Fijos ${money(fixedPeriod)}${word !== "mes" ? " (su parte)" : ""} · sueltos ${money(extraTotal)}${cashSpent ? ` · pagados de la caja ${money(cashSpent)}` : ""}`} />
        </div>

        <div className={`${card} grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] ${net >= 0 ? "border-emerald-500/50" : "border-red-500/50"}`}>
          <div className="min-w-0">
          <p className="text-sm text-zinc-400">
            Utilidad {isCurrent ? "hasta hoy" : `de ${periodName}`}
            <span className={`ml-1 font-black ${estimated ? "text-sky-300" : "text-emerald-400"}`}>{estimated ? "(estimada)" : hasApps ? "real ✓" : ""}</span>
          </p>
          <p className={`text-5xl font-black ${net >= 0 ? "text-emerald-400" : "text-red-400"}`}>{money(net)}</p>
          <p className="mt-1 text-sm text-zinc-400">
            Margen neto {pct(netMargin)} · ingresos {money(sales)} − costo {money(cost)} − gastos {money(expensesTotal)}
            {cashDiff < 0 ? ` − faltantes de caja ${money(-cashDiff)}` : cashDiff > 0 ? ` + sobrantes de caja ${money(cashDiff)}` : ""}
          </p>
          {estimated && (
            <p className="mt-1 text-xs text-sky-300">
              {(cur?.estimateTotal || 0) > 0
                ? `Incluye ${money(cur!.estimateTotal)} estimados de ${cur!.estimateByApp.map(([a]) => a).join(" y ")} (lo vendido menos comisiones). Cuando registres los depósitos reales de esas semanas, queda real.`
                : `Faltan los depósitos de ${cur!.pendingApps.join(" y ")}.`}
              {(cur?.unconfiguredApps.length || 0) > 0 ? ` ${cur!.unconfiguredApps.join(" y ")} sin comisiones configuradas: no se estima.` : ""}
            </p>
          )}
          {isCurrent && sales > 0 && (
            <p className="mt-2 text-sm">
              Si sigues al mismo ritmo, cierras {word === "mes" ? "el mes" : word === "semana" ? "la semana" : "el periodo"} con <b>{money(projection)}</b> de ingresos y una utilidad de{" "}
              <b className={projectedNet >= 0 ? "text-emerald-400" : "text-red-400"}>{money(projectedNet)}</b>.
            </p>
          )}
          {(cur?.cutsWithDiff.length || 0) > 0 && (
            <div className={`mt-3 rounded-2xl border p-3 text-xs ${cashDiff < 0 ? "border-red-500/40 bg-red-500/10 text-red-100" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"}`}>
              <p className="font-black">
                💵 Caja: {cashDiff < 0 ? `faltaron ${money(-cashDiff)}` : cashDiff > 0 ? `sobraron ${money(cashDiff)}` : "las diferencias se compensan"} en los cortes de {periodName} (ya está en la utilidad).
              </p>
              <ul className="mt-1 space-y-0.5">
                {cur!.cutsWithDiff.map((c) => (
                  <li key={c.folio}>
                    {new Date(c.closedAt).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" })} · {c.folio}: {c.difference < 0 ? "faltante" : "sobrante"} {money(Math.abs(c.difference))}
                    {c.reason ? ` (${c.reason})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {coverage < 90 && sales > 0 && (
            <p className="mt-3 rounded-2xl border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs text-yellow-100">
              ⚠️ Solo el {pct(coverage)} de lo vendido tiene receta con costo. Lo que no tiene receta cuenta como costo $0 y la utilidad se ve más alta de lo real.
              Completa tus recetas en Configuración → Recetas.
            </p>
          )}
          {foodCost > 45 && (cur?.costByIngredient.length || 0) > 0 && (
            <button type="button" onClick={() => setWhyOpen(true)} className="mt-3 block text-left text-xs font-bold text-zinc-400 underline-offset-2 hover:text-orange-400 hover:underline">
              🔎 ¿Por qué el food cost está en {pct(foodCost)}? Ver detalle
            </button>
          )}
          </div>

          {/* Compras del periodo: el dinero que salió (no se resta otra vez de la utilidad) */}
          <div className="rounded-2xl border border-zinc-800 bg-black p-4">
            <p className="text-sm font-black">🛒 Compras pagadas con {word === "semana" ? "los ingresos de esta semana" : `los ingresos de ${periodName}`}</p>
            <p className="mt-1 text-3xl font-black text-orange-400">{money(cur?.purchaseTotal || 0)}</p>
            <p className="text-xs text-zinc-500">
              {cur?.purchases.length || 0} compra{(cur?.purchases.length || 0) === 1 ? "" : "s"}
              {sales > 0 && (cur?.purchaseTotal || 0) > 0 ? ` · ${pct(((cur?.purchaseTotal || 0) / sales) * 100)} de tus ingresos` : ""}
            </p>
            {(cur?.purchaseSuppliers.length || 0) > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-zinc-300">
                {cur!.purchaseSuppliers.slice(0, 4).map(([name, total]) => (
                  <li key={name} className="flex justify-between gap-2">
                    <span className="truncate">{name}</span>
                    <b>{money(total)}</b>
                  </li>
                ))}
              </ul>
            )}
            {(cur?.paidElsewhere.length || 0) > 0 && (
              <p className="mt-2 text-xs text-sky-300">
                {cur!.paidElsewhere.length} compra{cur!.paidElsewhere.length === 1 ? "" : "s"} de estos días por {money(cur!.paidElsewhere.reduce((s, p) => s + p.total, 0))}{cur!.paidElsewhere.length === 1 ? " se pagó con ingresos de otra semana y no cuenta aquí." : " se pagaron con ingresos de otra semana y no cuentan aquí."}
              </p>
            )}
            <div className="mt-3 border-t border-zinc-800 pt-3 text-xs">
              <p className="flex justify-between gap-2 text-zinc-400">
                <span>Ingresos − compras − gastos</span>
                <b className={sales - (cur?.purchaseTotal || 0) - expensesTotal + cashDiff >= 0 ? "text-emerald-400" : "text-red-400"}>{money(sales - (cur?.purchaseTotal || 0) - expensesTotal + cashDiff)}</b>
              </p>
              <p className="mt-1 text-zinc-500">Lo que te queda en la bolsa. Las compras no se restan de la utilidad: ahí cuenta el costo de lo que vendiste (recetas), para no contarlas doble.</p>
            </div>
            <p className="mt-2 text-[11px] text-zinc-600">En Compras eliges con qué semana de ingresos se pagó cada una.</p>
          </div>
        </div>

        {/* Izquierda: gráfica con punto de equilibrio y gastos fijos. Derecha: gastos sueltos, pedidos de apps y depósitos */}
        {error && <p className="text-sm font-bold text-red-300">{error}</p>}
        <div className="grid items-start gap-6 xl:grid-cols-2">
          <div className="space-y-6">
        <section className={card}>
          <div className="grid gap-5 md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black">📈 Cómo vamos</h2>
              <p className="text-xs text-zinc-500">Acumulado día por día contra {previousName.toLowerCase()} en los mismos días.</p>
            </div>
            <div className="flex overflow-hidden rounded-2xl border border-zinc-800">
              {(
                [
                  ["ingresos", "Ingresos"],
                  ["utilidad", "Utilidad"],
                ] as const
              ).map(([k, text]) => (
                <button key={k} onClick={() => setChartMetric(k)} className={`px-3 py-1.5 text-xs font-black ${chartMetric === k ? "bg-orange-500 text-black" : "bg-black text-zinc-400 hover:text-white"}`}>
                  {text}
                </button>
              ))}
            </div>
          </div>
          {prevSameDays && prevSameDays.change !== null && (
            <p className={`mt-1 text-sm font-black ${prevSameDays.change >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {prevSameDays.change >= 0 ? "▲" : "▼"} {money(Math.abs(prevSameDays.now - prevSameDays.before))}
              {Math.abs(prevSameDays.change) <= 300 ? ` (${pct(Math.abs(prevSameDays.change))})` : ""} {prevSameDays.change >= 0 ? "más" : "menos"} en los primeros {Math.min(daysSoFar, cur?.days.length || 0)} días: {money(prevSameDays.now)} contra {money(prevSameDays.before)}
            </p>
          )}
          {chart && (
            <div className="mt-3">
              <FinanceChart
                labels={chart.labels}
                series={chart.series}
                dayName={chartMetric === "ingresos" ? "Ventas e ingresos del día" : "Utilidad del día"}
                currentName={currentName}
                previousName={previousName}
                format={money}
                footer={
                  bestDay && (
                    <p className="mt-3 rounded-2xl border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-300">
                      🏆 ¿Cuál fue el mejor día?: <b className="text-white">{bestDay.when}</b>, con <b className="text-emerald-400">{money(bestDay.amount)}</b>
                      {bestDay.average ? ` de ${chartMetric === "ingresos" ? "ingresos" : "utilidad"} en promedio (${bestDay.count} ${bestDay.unit})` : ` de ${chartMetric === "ingresos" ? "ingresos" : "utilidad"}`}
                      {bestDay.detail && <span className="text-zinc-500"> · {bestDay.detail}</span>}
                    </p>
                  )
                }
              />
            </div>
          )}
          {chartMetric === "utilidad" && <p className="mt-2 text-xs text-zinc-500">Utilidad de cada día: ingresos − costo de lo vendido − su parte de los gastos fijos − gastos sueltos de ese día.</p>}
          </div>
          <div className="flex min-w-0 flex-col items-center text-center md:border-l md:border-zinc-800 md:pl-5">
            <h2 className="whitespace-nowrap text-lg font-black">⚖️ Punto de equilibrio</h2>
            {status && <p className={`text-xs font-black ${estimated ? "text-sky-300" : "text-emerald-400"}`}>{estimated ? "Estimado (faltan depósitos de apps)" : "Real ✓"}</p>}
            {!toCover ? (
              <p className="mt-2 text-sm text-zinc-400">Agrega tus gastos fijos abajo para saber cuánto tienes que vender para no perder.</p>
            ) : !equilibrium ? (
              <p className="mt-2 text-sm text-zinc-400">Todavía no hay ingresos con costo en este periodo para calcularlo.</p>
            ) : (
              <>
                <p className="mt-1 text-xs text-zinc-300">
                  Para cubrir {money(toCover)} de gastos{cashDiff < 0 ? " y faltantes" : ""} {word === "mes" ? "del mes" : word === "semana" ? "de la semana" : "del periodo"}, con tu margen de {pct(grossMargin)}, necesitas ingresar{" "}
                  <b className="text-white">{money(equilibrium)}</b> (unos <b className="text-white">{money(dailyNeeded)}</b> diarios).
                </p>
                <ProgressRing value={progress} />
                <p className="text-xs">
                  {progress >= 100 ? (
                    <b className="text-emerald-400">✅ Ya cubriste tus gastos{isCurrent && coverDay ? ` (desde el día ${Math.min(coverDay, elapsed)})` : ""}: lo que ingreses de aquí en adelante es ganancia.</b>
                  ) : (
                    <>
                      Llevas {pct(progress)}. Te faltan <b className="text-white">{money(equilibrium - sales)}</b>
                      {isCurrent && coverDay ? (coverDay <= totalDays ? `; a este ritmo los cubres el día ${coverDay}.` : `; a este ritmo no alcanzas ${word === "mes" ? "este mes" : word === "semana" ? "esta semana" : "en el periodo"}.`) : "."}
                    </>
                  )}
                </p>
              </>
            )}
          </div>
          </div>
        </section>

          <section className={card}>
            <h2 className="text-lg font-black">🏠 Gastos fijos (cada mes)</h2>
            <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_8rem_auto]">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Renta del local" className={input} />
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="rounded-2xl border border-zinc-800 bg-black px-3 py-3">
                {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
              <input type="number" min={0} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="$ al mes" className={input} />
              <button
                onClick={() =>
                  run(() => {
                    addFixedExpense(form.name, form.category, Number(form.amount) || 0);
                    setForm({ name: "", category: form.category, amount: "" });
                  })
                }
                className="rounded-2xl bg-orange-500 px-4 py-3 font-black text-black"
              >
                Agregar
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {fixed.map((e) => (
                <div key={e.id} className="flex items-center gap-2 rounded-2xl bg-black p-3 text-sm">
                  <span className="flex-1">
                    <b>{e.name}</b> <span className="text-xs text-zinc-500">{e.category}</span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    defaultValue={e.amount}
                    onBlur={(ev) => Number(ev.target.value) !== e.amount && updateFixedExpense(e.id, Number(ev.target.value) || 0)}
                    className="w-28 rounded-xl border border-zinc-800 bg-zinc-950 px-2 py-1 text-right"
                  />
                  <button onClick={() => removeFixedExpense(e.id)} className="rounded-xl px-2 text-red-300" aria-label="Quitar">✕</button>
                </div>
              ))}
              {fixed.length === 0 && <p className="text-sm text-zinc-500">Ej. renta, sueldos, luz, gas, internet, publicidad.</p>}
              {fixed.length > 0 && <p className="text-right text-sm font-black">Total al mes: {money(fixedTotal)}</p>}
            </div>
          </section>

          </div>
          <div className="space-y-6">
            <section className={card}>
              <h2 className="text-lg font-black">🧾 Gastos sueltos</h2>
              <p className="text-xs text-zinc-500">Lo que no se repite: una reparación, un evento, material. Las compras de insumos ya cuentan en el costo de lo vendido, y lo que pagaste con dinero de la caja (Caja → Gasto) ya cuenta solo: no lo repitas aquí.</p>
              <div className="mt-3 grid gap-2 md:grid-cols-[9rem_1fr_7rem_auto]">
                <input type="date" value={extra.date} onChange={(e) => setExtra({ ...extra, date: e.target.value })} className={input} />
                <input value={extra.concept} onChange={(e) => setExtra({ ...extra, concept: e.target.value })} placeholder="Reparación del refri" className={input} />
                <input type="number" min={0} value={extra.amount} onChange={(e) => setExtra({ ...extra, amount: e.target.value })} placeholder="$" className={input} />
                <button
                  onClick={() =>
                    run(() => {
                      addExpense(extra.date, extra.concept, Number(extra.amount) || 0);
                      setExtra({ ...extra, concept: "", amount: "" });
                    })
                  }
                  className="rounded-2xl bg-orange-500 px-4 py-3 font-black text-black"
                >
                  Agregar
                </button>
              </div>
              <div className="mt-4 space-y-2">
                {[...(cur?.extras || [])]
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((e) => (
                    <div key={e.id} className="flex items-center gap-2 rounded-2xl bg-black p-3 text-sm">
                      <span className="w-24 text-xs text-zinc-500">{e.date}</span>
                      <span className="flex-1 font-bold">{e.concept}</span>
                      <span className="font-black">{money(e.amount)}</span>
                      <button onClick={() => removeExpense(e.id)} className="rounded-xl px-2 text-red-300" aria-label="Quitar">✕</button>
                    </div>
                  ))}
                {(cur?.extras.length || 0) === 0 && <p className="text-sm text-zinc-500">Sin gastos sueltos en {periodName}.</p>}
              </div>
            </section>

            <AppsPanel rows={cur?.byApp || []} periodName={periodName} money={money} pct={pct} />
            <section className={card}>
              <h2 className="text-lg font-black">💵 Otros ingresos (depósitos de delivery)</h2>
              <button type="button" onClick={() => setCommissionsOpen(true)} className="mt-1 text-xs font-bold text-zinc-400 underline-offset-2 hover:text-orange-400 hover:underline">
                ⚙️ Comisiones de apps{Object.values(commissions).some(isConfigured) ? "" : " (sin configurar)"}
              </button>
              <p className="text-xs text-zinc-500">
                Lo que te deposita cada app, ya sin comisiones ni impuestos. Elige de qué semana de ventas es: cuenta en esa semana aunque te caiga días después, para que las comparaciones sean justas.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="text-xs font-bold text-zinc-400">
                  Ventas de la semana
                  <select value={formWeek} onChange={(e) => setDeposit({ ...deposit, weekOf: e.target.value })} className={`${input} mt-1`}>
                    {weekOptions.map((w) => (
                      <option key={w} value={w}>
                        {weekText(w)}
                      </option>
                    ))}
                    <option value="dia">Ninguna: cuenta el día del depósito</option>
                  </select>
                </label>
                <label className="text-xs font-bold text-zinc-400">
                  Fecha del depósito
                  <input type="date" value={deposit.date} onChange={(e) => setDeposit({ ...deposit, date: e.target.value })} className={`${input} mt-1`} />
                </label>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-[7rem_1fr_7rem_auto]">
                <select value={deposit.source} onChange={(e) => setDeposit({ ...deposit, source: e.target.value })} className="rounded-2xl border border-zinc-800 bg-black px-3 py-3" aria-label="De dónde">
                  {INCOME_SOURCES.map((c) => <option key={c}>{c}</option>)}
                </select>
                <input value={deposit.concept} onChange={(e) => setDeposit({ ...deposit, concept: e.target.value })} placeholder="Nota (opcional)" className={input} />
                <input type="number" min={0} value={deposit.amount} onChange={(e) => setDeposit({ ...deposit, amount: e.target.value })} placeholder="$" className={input} aria-label="Monto depositado" />
                <button
                  onClick={() =>
                    run(() => {
                      addOtherIncome(deposit.date, deposit.source, deposit.concept, Number(deposit.amount) || 0, formWeek === "dia" ? "" : formWeek);
                      setDeposit({ ...deposit, concept: "", amount: "" });
                    })
                  }
                  className="rounded-2xl bg-emerald-500 px-4 py-3 font-black text-black"
                >
                  Agregar
                </button>
              </div>
              <div className="mt-4 space-y-2">
                {[...(cur?.deposits || [])]
                  .sort((a, b) => (b.weekOf || b.date).localeCompare(a.weekOf || a.date))
                  .map((i) => (
                    <div key={i.id} className="flex flex-wrap items-center gap-2 rounded-2xl bg-black p-3 text-sm">
                      <span className="min-w-0 flex-1">
                        <b>{i.source}</b> {i.concept && <span className="text-xs text-zinc-500">{i.concept}</span>}
                        <span className="block text-xs text-zinc-500">Depositado {shortDay(parseYmdLocal(i.date))}</span>
                      </span>
                      <select
                        value={i.weekOf || "dia"}
                        onChange={(e) => updateOtherIncome(i.id, { weekOf: e.target.value === "dia" ? "" : e.target.value })}
                        className="rounded-xl border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs"
                        aria-label="Semana de ventas"
                      >
                        {[...new Set([...(i.weekOf ? [i.weekOf] : []), ...weekOptions])].map((w) => (
                          <option key={w} value={w}>
                            {weekText(w)}
                          </option>
                        ))}
                        <option value="dia">Día del depósito</option>
                      </select>
                      <input
                        key={`${i.id}-${i.amount}`}
                        type="number"
                        min={0}
                        defaultValue={i.amount}
                        onBlur={(ev) => Number(ev.target.value) !== i.amount && updateOtherIncome(i.id, { amount: Number(ev.target.value) || 0 })}
                        className="w-24 rounded-xl border border-zinc-800 bg-zinc-950 px-2 py-1 text-right font-black text-emerald-400"
                        aria-label="Monto"
                      />
                      <button onClick={() => removeOtherIncome(i.id)} className="rounded-xl px-2 text-red-300" aria-label="Quitar">✕</button>
                    </div>
                  ))}
                {(cur?.deposits.length || 0) === 0 && <p className="text-sm text-zinc-500">Sin depósitos de {periodName}.</p>}
                {(cur?.deposits.length || 0) > 0 && (
                  <p className="text-right text-sm font-black">
                    Cuenta en {periodName}: {money(cur!.depositTotal)}
                    {Math.abs(cur!.deposits.reduce((t, i) => t + i.amount, 0) - cur!.depositTotal) > 1 && <span className="block text-xs font-normal text-zinc-500">Una semana queda entre dos meses: aquí cuentan solo sus días de este periodo.</span>}
                  </p>
                )}
              </div>
            </section>
          </div>
        </div>

        {commissionsOpen && <CommissionsDialog initial={commissions} apps={[...new Set([...DELIVERY_APPS, ...(cur?.byApp.map((a) => a.name) || [])])]} onClose={() => setCommissionsOpen(false)} />}
        {whyOpen && cur && (() => {
          const odd = cur.costByIngredient.filter((c) => ((c.unit === "g" || c.unit === "ml") && c.unitCost > 2) || ((c.unit === "kg" || c.unit === "L") && c.unitCost > 2000));
          const appCost = Math.max(0, cur.all.kpis.cost - cur.local.kpis.cost);
          const missingDeposits = cur.unconfiguredApps.length > 0;
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur" onClick={() => setWhyOpen(false)}>
              <div role="dialog" aria-label="Por qué el food cost está alto" className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-zinc-800 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-lg font-black">🔎 ¿Por qué el food cost está en {pct(foodCost)}?</h3>
                  <button onClick={() => setWhyOpen(false)} className="rounded-xl border border-zinc-800 px-3 py-1 font-black" aria-label="Cerrar">
                    ✕
                  </button>
                </div>
                {missingDeposits && (
                  <div className="mt-3 rounded-2xl border border-sky-500/40 bg-sky-500/10 p-3 text-sm text-sky-100">
                    <p className="font-black">🛵 Faltan los depósitos de las apps</p>
                    <p className="mt-1">
                      El costo incluye la comida de {cur.platformOrders} pedido{cur.platformOrders === 1 ? "" : "s"} de DiDi, Uber o Rappi ({money(appCost)}), pero lo de {cur.unconfiguredApps.join(" y ")} no está en los ingresos: registra sus depósitos en Otros ingresos o configura sus comisiones (⚙️ Comisiones de apps) para estimarlos.
                    </p>
                  </div>
                )}
                {coverage < 90 && (
                  <p className="mt-3 rounded-2xl border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-100">
                    Solo el {pct(coverage)} de lo vendido tiene receta completa con costo: mientras completas recetas y compras, este número todavía cambia.
                  </p>
                )}
                <p className="mt-4 text-sm font-black">Lo que más suma al costo</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {cur.costByIngredient.slice(0, 8).map((c) => {
                    const bad = odd.includes(c);
                    return (
                      <li key={c.id} className={`flex justify-between gap-3 ${bad ? "font-black text-red-300" : "text-zinc-300"}`}>
                        <span>
                          {c.name}: {Math.round(c.quantity * 100) / 100} {c.unit} × {c.unitCost < 1 ? `$${c.unitCost.toFixed(4)}` : money(c.unitCost)}/{c.unit}
                          {bad ? " ← muy caro por unidad" : ""}
                        </span>
                        <b>{money(c.cost)}</b>
                      </li>
                    );
                  })}
                </ul>
                {odd.length > 0 && (
                  <p className="mt-3 rounded-2xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-100">
                    Lo marcado en rojo cuesta demasiado por unidad: casi siempre la compra se capturó en otra unidad (ej. 10 cuando eran 10,000 g). Cancélala en Compras → Historial y vuelve a capturarla.
                  </p>
                )}
                {!missingDeposits && !odd.length && coverage >= 90 && (
                  <p className="mt-3 text-sm text-zinc-400">Los costos por unidad se ven normales: revisa precios de venta o porciones de las recetas de lo que más suma.</p>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </AppShell>
  );
}

/** ⚙️ Comisiones de apps: % de comisión y de impuestos por app, con el ejemplo de $1,000 */
function CommissionsDialog({ initial, apps, onClose }: { initial: Record<string, AppCommission>; apps: string[]; onClose: () => void }) {
  const [draft, setDraft] = useState<Record<string, { commission: string; taxes: string; taxOnSale: boolean }>>(() =>
    Object.fromEntries(apps.map((a) => [a, { commission: initial[a]?.commission ? String(initial[a].commission) : "", taxes: initial[a]?.taxes ? String(initial[a].taxes) : "", taxOnSale: Boolean(initial[a]?.taxOnSale) }]))
  );
  function save() {
    const next: Record<string, AppCommission> = {};
    for (const [app, d] of Object.entries(draft)) {
      const c = { commission: Math.min(100, Math.max(0, Number(d.commission) || 0)), taxes: Math.min(100, Math.max(0, Number(d.taxes) || 0)), ...(d.taxOnSale ? { taxOnSale: true } : {}) };
      if (isConfigured(c)) next[app] = c;
    }
    saveAppCommissions(next);
    onClose();
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur" onClick={onClose}>
      <div role="dialog" aria-label="Comisiones de apps" className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-zinc-800 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black">⚙️ Comisiones de apps</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Cuánto te quita cada app de lo vendido. Con esto B-POS estima tu depósito mientras no registras el real (Finanzas y App del dueño).
            </p>
          </div>
          <button onClick={onClose} className="rounded-xl border border-zinc-800 px-3 py-1 font-black" aria-label="Cerrar">
            ✕
          </button>
        </div>
        <div className="mt-4 space-y-3">
          {apps.map((app) => {
            const d = draft[app] || { commission: "", taxes: "", taxOnSale: false };
            const c = { commission: Number(d.commission) || 0, taxes: Number(d.taxes) || 0, taxOnSale: d.taxOnSale };
            const set = (patch: Partial<typeof d>) => setDraft((all) => ({ ...all, [app]: { ...d, ...patch } }));
            const afterCommission = 1000 * (1 - Math.min(100, c.commission) / 100);
            return (
              <div key={app} className="rounded-2xl border border-zinc-800 bg-black p-3">
                <p className="font-black">🛵 {app}</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="text-xs font-bold text-zinc-400">
                    Comisión % (sobre lo vendido)
                    <input type="number" min={0} max={100} step="0.1" value={d.commission} onChange={(e) => set({ commission: e.target.value })} placeholder="30" className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-white" />
                  </label>
                  <label className="text-xs font-bold text-zinc-400">
                    Impuestos / retenciones %
                    <input type="number" min={0} max={100} step="0.1" value={d.taxes} onChange={(e) => set({ taxes: e.target.value })} placeholder="17" className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-white" />
                  </label>
                </div>
                <select value={d.taxOnSale ? "venta" : "resto"} onChange={(e) => set({ taxOnSale: e.target.value === "venta" })} className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs" aria-label={`Sobre qué se cobran los impuestos de ${app}`}>
                  <option value="resto">Impuestos sobre lo que queda después de la comisión</option>
                  <option value="venta">Impuestos sobre lo vendido</option>
                </select>
                {isConfigured(c) ? (
                  <p className="mt-2 text-xs text-zinc-400">
                    Ej. $1,000 vendidos{!c.taxOnSale && c.commission ? ` → $${afterCommission.toFixed(0)} después de comisión` : ""} → te depositan aprox. <b className="text-white">${(1000 * netFactor(c)).toFixed(0)}</b> ({(netFactor(c) * 100).toFixed(1)}%)
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-zinc-600">Sin configurar: no se estima su depósito.</p>
                )}
              </div>
            );
          })}
        </div>
        <button onClick={save} className="mt-4 w-full rounded-2xl bg-orange-500 py-3 font-black text-black">
          Guardar comisiones
        </button>
      </div>
    </div>
  );
}
