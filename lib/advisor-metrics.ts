"use client";
/**
 * Números del negocio para el Asesor con IA (App del dueño, chat y el
 * resumen por correo de cada lunes). Compactos: solo lo que el asesor usa.
 */
import { getBusinessSettings } from "@/lib/business-settings";
import { getCoupons, couponState } from "@/lib/coupons";
import { buildCustomers } from "@/lib/customers";
import { breakEven, financeRanges, fixedForRange, getExpenses, getFixedExpenses, getOtherIncome, isPlatformOrder, periodDays, elapsedDays, ymd, type FinancePeriod, type Range } from "@/lib/finance";
import { buildReport, loadReportSources, presetRange, type ReportOrder, type Row } from "@/lib/reports";
import { DAY_NAMES } from "@/lib/sale-schedule";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
export const today = () => new Date().toISOString().slice(0, 10);

function kpis(k: ReturnType<typeof buildReport>["kpis"]) {
  return { ventas: r2(k.sales), pedidos: k.orders, ticketPromedio: r2(k.averageTicket), descuentos: r2(k.discounts), costo: r2(k.cost), utilidadBruta: r2(k.profit), margenPct: r2(k.margin) };
}

/** En qué periodo se enfoca el asesor (App del dueño → Asesor IA → 📅) */
export type AdvisorPeriodKey = Exclude<FinancePeriod, "rango"> | "rango" | "historia";
export type AdvisorPeriod = { key: AdvisorPeriodKey; from?: string; to?: string };
export const ADVISOR_PERIODS: [AdvisorPeriodKey, string][] = [
  ["semana", "Esta semana"],
  ["mes", "Este mes"],
  ["semana-pasada", "Semana pasada"],
  ["mes-pasado", "Mes pasado"],
  ["rango", "Rango personalizado"],
  ["historia", "Toda la historia"],
];

const shortDate = (d: Date) => d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });

/** Fechas del periodo y del anterior para comparar (toda la historia no tiene anterior) */
export function advisorRanges(p: AdvisorPeriod, orders: { createdAt: string }[], now = new Date()): { main: Range; previous: Range | null; label: string } {
  const name = ADVISOR_PERIODS.find(([k]) => k === p.key)?.[1] || "Esta semana";
  if (p.key === "historia") {
    const first = orders.reduce((min, o) => Math.min(min, new Date(o.createdAt).getTime() || min), now.getTime());
    const from = new Date(first);
    return { main: { from: new Date(from.getFullYear(), from.getMonth(), from.getDate()), to: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) }, previous: null, label: name };
  }
  const r = financeRanges(p.key, { from: p.from || "", to: p.to || "" }, now);
  return { ...r, label: name };
}

export function advisorPeriodText(p: AdvisorPeriod, orders: { createdAt: string }[] = []) {
  const r = advisorRanges(p, orders);
  return `${r.label} (${shortDate(r.main.from)} al ${shortDate(new Date(r.main.to.getTime() - 86_400_000))})`;
}

/** Los números que ve el asesor (compactos). Con `period`, solo los de ese periodo y el anterior. */
export function buildMetrics(orders: ReportOrder[], branchLabel: string, period?: AdvisorPeriod) {
  const src = { ...loadReportSources(), orders };
  const now = new Date();
  if (period) return periodMetrics(src, orders, branchLabel, period, now);
  const day = 24 * 60 * 60 * 1000;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const week = buildReport(src, { from: new Date(start.getTime() - 7 * day), to: start });
  const prev = buildReport(src, { from: new Date(start.getTime() - 14 * day), to: new Date(start.getTime() - 7 * day) });
  const month = buildReport(src, presetRange("mes"));
  const last28 = buildReport(src, { from: new Date(start.getTime() - 28 * day), to: start });

  const byWeekday = DAY_NAMES.map((name) => ({ dia: name, ventas: 0, pedidos: 0 }));
  last28.byDay.forEach((r) => {
    const [y, m, d] = r.label.split("-").map(Number);
    const w = byWeekday[new Date(y, m - 1, d).getDay()];
    w.ventas = r2(w.ventas + r.sales);
    w.pedidos += r.count;
  });
  const fixed = getFixedExpenses().reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const loose = getExpenses().filter((e) => e.date >= monthStart).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  // Como en Finanzas: ingreso = ventas del local y menú + depósitos de las apps (no su precio al cliente); el costo es de todo
  const monthLocal = buildReport({ ...src, orders: orders.filter((o) => !isPlatformOrder(o)) }, presetRange("mes")).kpis.sales;
  const deposits = getOtherIncome().filter((i) => i.date >= monthStart).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const monthIncome = monthLocal + deposits;
  const monthMargin = monthIncome > 0 ? ((monthIncome - month.kpis.cost) / monthIncome) * 100 : 0;
  const customers = buildCustomers(orders as Parameters<typeof buildCustomers>[0]);
  const product = (r: Row) => ({ nombre: r.label, piezas: r.quantity, ventas: r2(r.sales), costo: r2(r.cost), margenPct: r.cost ? r2(r.margin) : null });

  return {
    negocio: getBusinessSettings().businessName,
    sucursal: branchLabel,
    fecha: now.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    ultimos7Dias: kpis(week.kpis),
    los7DiasAnteriores: kpis(prev.kpis),
    mesEnCurso: {
      ...kpis(month.kpis),
      diasTranscurridos: now.getDate(),
      diasDelMes: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
      foodCostPct: month.kpis.sales ? r2((month.kpis.cost / month.kpis.sales) * 100) : null,
      gastosFijosDelMes: r2(fixed),
      gastosSueltosDelMes: r2(loose),
      ventasLocalYMenu: r2(monthLocal),
      depositosDeApps: r2(deposits),
      ventasAppsPrecioAlCliente: r2(month.kpis.sales - monthLocal),
      utilidadReal: r2(monthIncome - month.kpis.cost - fixed - loose),
      puntoDeEquilibrioMensual: breakEven(fixed + loose, monthMargin) ? r2(breakEven(fixed + loose, monthMargin)!) : null,
      ventasConCostoPct: r2(month.kpis.costCoverage),
    },
    ultimas4Semanas: {
      porDiaDeLaSemana: byWeekday,
      porHora: last28.byHour.filter((r) => r.count > 0).map((r) => ({ hora: `${r.label}:00`, ventas: r2(r.sales), pedidos: r.count })),
      platillos: last28.byProduct.slice(0, 20).map(product),
      categorias: last28.byCategory.slice(0, 10).map((r) => ({ nombre: r.label, ventas: r2(r.sales), margenPct: r.cost ? r2(r.margin) : null })),
      canales: last28.byChannel.map((r) => ({ canal: r.label, ventas: r2(r.sales), pedidos: r.count })),
      pagos: last28.byPayment.map((r) => ({ forma: r.label, ventas: r2(r.sales) })),
    },
    clientes: {
      conNombreOTelefono: customers.length,
      nuevosUltimos30Dias: customers.filter((c) => c.segment === "nuevo").length,
      frecuentes: customers.filter((c) => c.segment === "frecuente" || c.segment === "vip").length,
      dormidos45Dias: customers.filter((c) => c.segment === "dormido").length,
    },
    cuponesActivos: getCoupons().filter((c) => couponState(c) === "activo").map((c) => ({ codigo: c.code, usos: c.uses })),
  };
}


/** Solo el periodo elegido: sus ventas, utilidad, días, horas, platillos y canales, contra el periodo anterior */
function periodMetrics(src: ReturnType<typeof loadReportSources>, orders: ReportOrder[], branchLabel: string, period: AdvisorPeriod, now: Date) {
  const { main, previous, label } = advisorRanges(period, orders, now);
  const report = buildReport(src, main);
  const before = previous ? buildReport(src, previous) : null;
  const from = ymd(main.from);
  const to = ymd(main.to);
  const inRange = (date: string) => date >= from && date < to;

  const byWeekday = DAY_NAMES.map((name) => ({ dia: name, ventas: 0, pedidos: 0 }));
  report.byDay.forEach((r) => {
    const [y, m, d] = r.label.split("-").map(Number);
    const w = byWeekday[new Date(y, m - 1, d).getDay()];
    w.ventas = r2(w.ventas + r.sales);
    w.pedidos += r.count;
  });
  // Como en Finanzas: ingreso = ventas del local y menú + depósitos de las apps (no su precio al cliente); el costo es de todo
  const localSales = buildReport({ ...src, orders: orders.filter((o) => !isPlatformOrder(o)) }, main).kpis.sales;
  const deposits = getOtherIncome().filter((i) => inRange(i.weekOf || i.date)).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const income = localSales + deposits;
  const fixed = fixedForRange(getFixedExpenses().reduce((s, e) => s + (Number(e.amount) || 0), 0), main);
  const loose = getExpenses().filter((e) => inRange(e.date)).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const cashDiff = src.shifts.filter((c) => !c.voided && c.closedAt && inRange(ymd(new Date(c.closedAt)))).reduce((s, c) => s + (Number(c.difference) || 0), 0);
  const margin = income > 0 ? ((income - report.kpis.cost) / income) * 100 : 0;
  const equilibrium = breakEven(fixed + loose - cashDiff, margin);
  const customers = buildCustomers(orders as Parameters<typeof buildCustomers>[0]);
  const product = (r: Row) => ({ nombre: r.label, piezas: r.quantity, ventas: r2(r.sales), costo: r2(r.cost), margenPct: r.cost ? r2(r.margin) : null });

  return {
    negocio: getBusinessSettings().businessName,
    sucursal: branchLabel,
    fecha: now.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    periodo: {
      nombre: label,
      desde: from,
      hastaIncluido: ymd(new Date(main.to.getTime() - 86_400_000)),
      dias: periodDays(main),
      diasTranscurridos: elapsedDays(main, now),
      ...kpis(report.kpis),
      foodCostPct: income ? r2((report.kpis.cost / income) * 100) : null,
      ventasLocalYMenu: r2(localSales),
      depositosDeApps: r2(deposits),
      ventasAppsPrecioAlCliente: r2(report.kpis.sales - localSales),
      gastosFijosDelPeriodo: r2(fixed),
      gastosSueltos: r2(loose),
      faltantesOSobrantesDeCaja: r2(cashDiff),
      utilidadReal: r2(income - report.kpis.cost - fixed - loose + cashDiff),
      puntoDeEquilibrio: equilibrium ? r2(equilibrium) : null,
      ventasConCostoPct: r2(report.kpis.costCoverage),
      porDiaDeLaSemana: byWeekday,
      porHora: report.byHour.filter((r) => r.count > 0).map((r) => ({ hora: `${r.label}:00`, ventas: r2(r.sales), pedidos: r.count })),
      platillos: report.byProduct.slice(0, 20).map(product),
      categorias: report.byCategory.slice(0, 10).map((r) => ({ nombre: r.label, ventas: r2(r.sales), margenPct: r.cost ? r2(r.margin) : null })),
      canales: report.byChannel.map((r) => ({ canal: r.label, ventas: r2(r.sales), pedidos: r.count })),
      pagos: report.byPayment.map((r) => ({ forma: r.label, ventas: r2(r.sales) })),
    },
    periodoAnterior: before && previous ? { desde: ymd(previous.from), hastaIncluido: ymd(new Date(previous.to.getTime() - 86_400_000)), ...kpis(before.kpis) } : null,
    clientes: {
      conNombreOTelefono: customers.length,
      nuevosUltimos30Dias: customers.filter((c) => c.segment === "nuevo").length,
      frecuentes: customers.filter((c) => c.segment === "frecuente" || c.segment === "vip").length,
      dormidos45Dias: customers.filter((c) => c.segment === "dormido").length,
    },
    cuponesActivos: getCoupons().filter((c) => couponState(c) === "activo").map((c) => ({ codigo: c.code, usos: c.uses })),
  };
}
