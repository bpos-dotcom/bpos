"use client";
/**
 * Números del negocio para el Asesor con IA (App del dueño, chat y el
 * resumen por correo de cada lunes). Compactos: solo lo que el asesor usa.
 */
import { getBusinessSettings } from "@/lib/business-settings";
import { getCoupons, couponState } from "@/lib/coupons";
import { buildCustomers } from "@/lib/customers";
import { breakEven, getExpenses, getFixedExpenses } from "@/lib/finance";
import { buildReport, loadReportSources, presetRange, type ReportOrder, type Row } from "@/lib/reports";
import { DAY_NAMES } from "@/lib/sale-schedule";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
export const today = () => new Date().toISOString().slice(0, 10);

function kpis(k: ReturnType<typeof buildReport>["kpis"]) {
  return { ventas: r2(k.sales), pedidos: k.orders, ticketPromedio: r2(k.averageTicket), descuentos: r2(k.discounts), costo: r2(k.cost), utilidadBruta: r2(k.profit), margenPct: r2(k.margin) };
}

/** Los números que ve el asesor (compactos) */
export function buildMetrics(orders: ReportOrder[], branchLabel: string) {
  const src = { ...loadReportSources(), orders };
  const now = new Date();
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
  const monthMargin = month.kpis.sales > 0 ? (month.kpis.profit / month.kpis.sales) * 100 : 0;
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
      utilidadReal: r2(month.kpis.profit - fixed - loose),
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

