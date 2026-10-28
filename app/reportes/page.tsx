"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { canViewCosts, getCurrentUser } from "@/lib/auth";
import { getBusinessSettings } from "@/lib/business-settings";
import {
  addDays,
  buildReport,
  loadBranchSales,
  loadReportSources,
  presetRange,
  startOfDay,
  type DateRange,
  type RangePreset,
  type ReportData,
  type Row,
} from "@/lib/reports";
import { downloadXlsx, type Cell, type Sheet } from "@/lib/xlsx";
import { isCloudConfigured } from "@/lib/supabase/client";

type Tab = "ventas" | "productos" | "canales" | "sucursales" | "turnos" | "compras" | "inventario";

const PRESETS: { id: RangePreset; label: string }[] = [
  { id: "hoy", label: "Hoy" },
  { id: "ayer", label: "Ayer" },
  { id: "7d", label: "7 días" },
  { id: "30d", label: "30 días" },
  { id: "mes", label: "Este mes" },
  { id: "mes-pasado", label: "Mes pasado" },
];

const money = (v: number) => `$${(Number(v) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v: number) => (Number(v) || 0).toLocaleString("es-MX", { maximumFractionDigits: 2 });
const pct = (v: number) => `${(Number(v) || 0).toFixed(1)}%`;
const toInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromInput = (v: string) => {
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const shortDay = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
};

export default function ReportesPage() {
  const [preset, setPreset] = useState<RangePreset | "custom">("hoy");
  const [range, setRange] = useState<DateRange>(() => presetRange("hoy"));
  const [report, setReport] = useState<ReportData | null>(null);
  const [tab, setTab] = useState<Tab>("ventas");
  const [branches, setBranches] = useState<Row[] | null>(null);
  const [branchError, setBranchError] = useState("");
  const [showCosts, setShowCosts] = useState(false);

  const refresh = useCallback(() => {
    setReport(buildReport(loadReportSources(), range));
  }, [range]);

  useEffect(() => {
    setShowCosts(canViewCosts(getCurrentUser().role));
    refresh();
    const events = ["bpos:orders-updated", "bpos:purchases-updated", "bpos:cash-history-updated", "bpos:inventory-updated", "storage"];
    events.forEach((e) => window.addEventListener(e, refresh));
    return () => events.forEach((e) => window.removeEventListener(e, refresh));
  }, [refresh]);

  useEffect(() => {
    if (tab !== "sucursales" || !isCloudConfigured) return;
    setBranches(null);
    setBranchError("");
    loadBranchSales(range)
      .then((rows) => setBranches(rows ?? []))
      .catch((e) => setBranchError(e instanceof Error ? e.message : "No se pudo consultar la nube."));
  }, [tab, range]);

  function choosePreset(p: RangePreset) {
    setPreset(p);
    setRange(presetRange(p));
  }

  const rangeLabel = useMemo(() => {
    const last = addDays(range.to, -1);
    const fmt = (d: Date) => d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
    return toInput(range.from) === toInput(last) ? fmt(range.from) : `${fmt(range.from)} – ${fmt(last)}`;
  }, [range]);

  function exportExcel() {
    if (!report) return;
    const k = report.kpis;
    const rowsTable = (rows: Row[], first: string, opts: { qty?: boolean; count?: boolean } = {}): Cell[][] => [
      [first, ...(opts.count ? ["Pedidos"] : []), ...(opts.qty ? ["Cantidad"] : []), "Venta", ...(showCosts ? ["Costo", "Utilidad", "Margen %"] : [])],
      ...rows.map((r) => [
        r.label,
        ...(opts.count ? [r.count] : []),
        ...(opts.qty ? [r.quantity] : []),
        r.sales,
        ...(showCosts ? [r.cost, r.profit, r.margin] : []),
      ]),
    ];

    const sheets: Sheet[] = [
      {
        name: "Resumen",
        rows: [
          ["Concepto", "Valor"],
          ["Negocio", getBusinessSettings().businessName],
          ["Periodo", rangeLabel],
          ["Ventas", k.sales],
          ["Pedidos", k.orders],
          ["Ticket promedio", k.averageTicket],
          ["Descuentos", k.discounts],
          ["Artículos vendidos", k.itemsSold],
          ...(showCosts
            ? ([
                ["Costo de insumos (estimado)", k.cost],
                ["Utilidad bruta", k.profit],
                ["Margen bruto %", k.margin],
                ["% de ventas con costo conocido", k.costCoverage],
                ["Valor del inventario actual", k.inventoryValue],
              ] as Cell[][])
            : []),
          ["Compras del periodo", k.purchases],
        ],
      },
      { name: "Ventas por día", rows: rowsTable(report.byDay.map((r) => ({ ...r, label: r.label })), "Día", { count: true }) },
      { name: "Ventas por hora", rows: rowsTable(report.byHour.filter((r) => r.count > 0).map((r) => ({ ...r, label: `${r.label}:00` })), "Hora", { count: true }) },
      { name: "Productos", rows: rowsTable(report.byProduct, "Producto", { qty: true }) },
      { name: "Categorías", rows: rowsTable(report.byCategory, "Categoría", { qty: true }) },
      { name: "Canales", rows: rowsTable(report.byChannel, "Canal / plataforma", { count: true }) },
      { name: "Métodos de pago", rows: rowsTable(report.byPayment, "Método", { count: true }) },
      {
        name: "Pedidos",
        rows: [
          ["Folio", "Fecha", "Canal", "Pago", "Cliente", "Artículos", "Descuento", "Total"],
          ...report.orders.map((o) => [
            String(o.localOrderNumber ?? o.id),
            new Date(o.createdAt).toLocaleString("es-MX"),
            o.source === "B-POS Bridge" ? o.externalPlatform || o.details?.orderType || "" : o.details?.orderType || "",
            o.details?.paymentMethod || "",
            o.details?.customerName || "",
            (o.items || []).map((i) => `${i.quantity}× ${i.name}`).join(", "),
            Number(o.details?.discount) || 0,
            Number(o.total) || 0,
          ]),
        ],
      },
      {
        name: "Turnos",
        rows: [
          ["Folio", "Apertura", "Cierre", "Abrió", "Cerró", "Fondo", "Ventas", "Pedidos", "Efectivo esperado", "Efectivo contado", "Diferencia"],
          ...report.shifts.map((s) => [
            s.folio,
            new Date(s.openedAt).toLocaleString("es-MX"),
            new Date(s.closedAt).toLocaleString("es-MX"),
            s.openedBy || "",
            s.closedBy || "",
            s.openingCash,
            s.totalSales,
            s.orderCount,
            s.expectedCash,
            s.countedCash,
            s.difference,
          ]),
        ],
      },
      {
        name: "Compras",
        rows: [
          ["Folio", "Fecha", "Proveedor", "Ticket", "Origen", "Total", "Artículos"],
          ...report.purchases.map((p) => [
            p.folio,
            new Date(p.createdAt).toLocaleString("es-MX"),
            p.supplier,
            p.invoice || "",
            p.source,
            p.total,
            p.items.map((i) => `${i.ingredientName} ${i.inventoryQuantity} ${i.unit}`).join(", "),
          ]),
        ],
      },
      {
        name: "Inventario",
        rows: [
          ["Ingrediente", "Unidad", "Existencia", "Mínimo", ...(showCosts ? ["Costo unitario", "Valor"] : []), "Estado"],
          ...report.inventory.map((i) => [
            i.name,
            i.unit,
            i.stock,
            i.minimum,
            ...(showCosts ? [i.unitCost, i.value] : []),
            i.low ? "Bajo mínimo" : "OK",
          ]),
        ],
      },
    ];
    downloadXlsx(`Reporte B-POS ${toInput(range.from)} a ${toInput(addDays(range.to, -1))}`, sheets);
  }

  const k = report?.kpis;

  return (
    <AppShell title="Reportes" subtitle="Ventas, productos, canales, turnos, compras e inventario por periodo.">
      <div className="space-y-6">
        {/* Filtros */}
        <section className="no-print flex flex-wrap items-end gap-3 rounded-3xl border border-zinc-800 bg-zinc-950 p-4">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => choosePreset(p.id)}
                className={`rounded-2xl border px-4 py-2 text-sm font-black ${
                  preset === p.id ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-800 bg-black text-zinc-300 hover:border-orange-500"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <label className="text-xs text-zinc-500">
            Desde
            <input
              type="date"
              value={toInput(range.from)}
              onChange={(e) => {
                if (!e.target.value) return;
                setPreset("custom");
                const from = startOfDay(fromInput(e.target.value));
                setRange((r) => ({ from, to: r.to > from ? r.to : addDays(from, 1) }));
              }}
              className="mt-1 block rounded-xl border border-zinc-800 bg-black px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-zinc-500">
            Hasta
            <input
              type="date"
              value={toInput(addDays(range.to, -1))}
              onChange={(e) => {
                if (!e.target.value) return;
                setPreset("custom");
                const to = addDays(startOfDay(fromInput(e.target.value)), 1);
                setRange((r) => ({ from: r.from < to ? r.from : addDays(to, -1), to }));
              }}
              className="mt-1 block rounded-xl border border-zinc-800 bg-black px-3 py-2 text-sm text-white"
            />
          </label>
          <div className="ml-auto flex gap-2">
            <button onClick={exportExcel} className="rounded-2xl border border-green-500/50 bg-green-500/10 px-4 py-2 text-sm font-black text-green-300">
              📥 Excel
            </button>
            <button onClick={() => window.print()} className="rounded-2xl border border-zinc-700 px-4 py-2 text-sm font-black text-zinc-200">
              🖨️ PDF / Imprimir
            </button>
          </div>
        </section>

        <p className="print-only hidden text-lg font-black">
          {getBusinessSettings().businessName} · Reporte {rangeLabel}
        </p>

        {!report || !k ? (
          <p className="text-zinc-500">Calculando...</p>
        ) : (
          <>
            {/* Indicadores */}
            <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi title="Ventas" value={money(k.sales)} hint={rangeLabel} />
              <Kpi title="Pedidos" value={num(k.orders)} hint={`${num(k.itemsSold)} artículos`} />
              <Kpi title="Ticket promedio" value={money(k.averageTicket)} hint={k.discounts ? `Descuentos ${money(k.discounts)}` : "Sin descuentos"} />
              {showCosts ? (
                <Kpi
                  title="Utilidad bruta"
                  value={money(k.profit)}
                  hint={`Margen ${pct(k.margin)} · costo ${money(k.cost)}`}
                  accent={k.profit >= 0 ? "text-green-400" : "text-red-400"}
                />
              ) : (
                <Kpi title="Compras" value={money(k.purchases)} hint="del periodo" />
              )}
            </section>

            {showCosts && k.sales > 0 && k.costCoverage < 99.5 && (
              <p className="rounded-2xl border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-200">
                ⚠️ La utilidad es estimada: {pct(100 - k.costCoverage)} de las ventas incluye productos sin receta o
                ingredientes sin costo de compra. Completa recetas (Configuración) y registra compras con costo para
                afinarla.
              </p>
            )}

            {/* Pestañas */}
            <div className="no-print flex flex-wrap gap-2">
              {(
                [
                  ["ventas", "📈 Ventas"],
                  ["productos", "🍔 Productos"],
                  ["canales", "🛵 Canales y pagos"],
                  ["sucursales", "🏬 Sucursales"],
                  ["turnos", "💵 Turnos"],
                  ["compras", "🧾 Compras"],
                  ["inventario", "📦 Inventario"],
                ] as [Tab, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`rounded-2xl border px-4 py-2 text-sm font-black ${
                    tab === id ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-orange-500"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "ventas" && (
              <div className="grid gap-6 xl:grid-cols-2">
                <Panel title="Ventas por día">
                  <Bars rows={report.byDay.map((r) => ({ ...r, label: shortDay(r.label) }))} />
                </Panel>
                <Panel title="Horas con más venta">
                  <Bars rows={report.byHour.filter((r) => r.count > 0).map((r) => ({ ...r, label: `${r.label}:00` }))} empty="Sin ventas en el periodo." />
                </Panel>
                <Panel title="Detalle por día" wide>
                  <Table rows={report.byDay.map((r) => ({ ...r, label: shortDay(r.label) }))} first="Día" showCosts={showCosts} count />
                </Panel>
              </div>
            )}

            {tab === "productos" && (
              <div className="grid gap-6 xl:grid-cols-2">
                <Panel title="Productos" wide>
                  <Table rows={report.byProduct} first="Producto" showCosts={showCosts} qty />
                </Panel>
                <Panel title="Categorías" wide>
                  <Table rows={report.byCategory} first="Categoría" showCosts={showCosts} qty />
                </Panel>
              </div>
            )}

            {tab === "canales" && (
              <div className="grid gap-6 xl:grid-cols-2">
                <Panel title="Por canal / plataforma">
                  <Bars rows={report.byChannel} />
                  <div className="mt-4">
                    <Table rows={report.byChannel} first="Canal" showCosts={showCosts} count />
                  </div>
                </Panel>
                <Panel title="Por método de pago">
                  <Bars rows={report.byPayment} />
                  <div className="mt-4">
                    <Table rows={report.byPayment} first="Método" showCosts={false} count />
                  </div>
                </Panel>
              </div>
            )}

            {tab === "sucursales" && (
              <Panel title="Ventas por sucursal">
                {!isCloudConfigured ? (
                  <p className="text-sm text-zinc-500">Disponible con la nube conectada.</p>
                ) : branchError ? (
                  <p className="text-sm text-red-400">{branchError}</p>
                ) : !branches ? (
                  <p className="text-sm text-zinc-500">Consultando la nube...</p>
                ) : (
                  <>
                    <Bars rows={branches} />
                    <div className="mt-4">
                      <Table rows={branches} first="Sucursal" showCosts={false} count />
                    </div>
                  </>
                )}
              </Panel>
            )}

            {tab === "turnos" && (
              <Panel title={`Cortes de caja (${report.shifts.length})`}>
                {report.shifts.length === 0 ? (
                  <p className="text-sm text-zinc-500">No hay cortes cerrados en este periodo.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead>
                        <tr className="text-left text-zinc-500">
                          <th className="pb-2">Folio</th>
                          <th className="pb-2">Turno</th>
                          <th className="pb-2">Cerró</th>
                          <th className="pb-2 text-right">Ventas</th>
                          <th className="pb-2 text-right">Pedidos</th>
                          <th className="pb-2 text-right">Esperado</th>
                          <th className="pb-2 text-right">Contado</th>
                          <th className="pb-2 text-right">Diferencia</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.shifts.map((s) => (
                          <tr key={s.id} className="border-t border-zinc-800">
                            <td className="py-2 font-bold">{s.folio}</td>
                            <td className="py-2 text-zinc-400">
                              {new Date(s.openedAt).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })} →{" "}
                              {new Date(s.closedAt).toLocaleTimeString("es-MX", { timeStyle: "short" })}
                            </td>
                            <td className="py-2 text-zinc-400">{s.closedBy || "—"}</td>
                            <td className="py-2 text-right font-bold">{money(s.totalSales)}</td>
                            <td className="py-2 text-right">{s.orderCount}</td>
                            <td className="py-2 text-right">{money(s.expectedCash)}</td>
                            <td className="py-2 text-right">{money(s.countedCash)}</td>
                            <td className={`py-2 text-right font-black ${Math.abs(s.difference) < 0.01 ? "text-zinc-300" : s.difference > 0 ? "text-green-400" : "text-red-400"}`}>
                              {s.difference > 0 ? "+" : ""}
                              {money(s.difference)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            )}

            {tab === "compras" && (
              <div className="grid gap-6 xl:grid-cols-2">
                <Panel title={`Compras por proveedor · ${money(k.purchases)}`}>
                  <Bars rows={report.purchasesBySupplier} empty="Sin compras en el periodo." />
                </Panel>
                <Panel title="Ingredientes comprados">
                  {report.purchasedIngredients.length === 0 ? (
                    <p className="text-sm text-zinc-500">Sin compras en el periodo.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-zinc-500">
                          <th className="pb-2">Ingrediente</th>
                          <th className="pb-2 text-right">Cantidad</th>
                          <th className="pb-2 text-right">Gasto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.purchasedIngredients.map((r) => (
                          <tr key={r.label} className="border-t border-zinc-800">
                            <td className="py-2">{r.label}</td>
                            <td className="py-2 text-right">{num(r.quantity)}</td>
                            <td className="py-2 text-right font-bold">{money(r.sales)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Panel>
              </div>
            )}

            {tab === "inventario" && (
              <div className="grid gap-6 xl:grid-cols-2">
                <Panel title={showCosts ? `Inventario actual · valor ${money(k.inventoryValue)}` : "Inventario actual"} wide>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead>
                        <tr className="text-left text-zinc-500">
                          <th className="pb-2">Ingrediente</th>
                          <th className="pb-2 text-right">Existencia</th>
                          <th className="pb-2 text-right">Mínimo</th>
                          {showCosts && <th className="pb-2 text-right">Costo unit.</th>}
                          {showCosts && <th className="pb-2 text-right">Valor</th>}
                          <th className="pb-2 text-right">Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.inventory.map((i) => (
                          <tr key={i.name} className="border-t border-zinc-800">
                            <td className="py-2">{i.name}</td>
                            <td className="py-2 text-right">
                              {num(i.stock)} {i.unit}
                            </td>
                            <td className="py-2 text-right text-zinc-400">
                              {num(i.minimum)} {i.unit}
                            </td>
                            {showCosts && <td className="py-2 text-right text-zinc-400">{i.unitCost ? `$${i.unitCost.toFixed(4)}` : "—"}</td>}
                            {showCosts && <td className="py-2 text-right font-bold">{money(i.value)}</td>}
                            <td className={`py-2 text-right text-xs font-black ${i.low ? "text-yellow-300" : "text-zinc-500"}`}>
                              {i.low ? "⚠️ Bajo mínimo" : "OK"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
                <Panel title="Movimientos del periodo (Kardex)" wide>
                  {report.movements.length === 0 ? (
                    <p className="text-sm text-zinc-500">Sin movimientos en el periodo.</p>
                  ) : (
                    <div className="space-y-4">
                      {report.movements.map((m) => (
                        <div key={m.type}>
                          <p className="font-black text-orange-400">
                            {m.type} · {m.count} movimiento(s)
                          </p>
                          <ul className="mt-1 space-y-1 text-sm text-zinc-300">
                            {m.byIngredient.slice(0, 12).map((i) => (
                              <li key={i.name} className="flex justify-between gap-4 border-b border-zinc-900 py-1">
                                <span>{i.name}</span>
                                <span className="font-bold">
                                  {num(i.quantity)} {i.unit}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </Panel>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

// ------------------------------------------------------------ piezas

function Kpi({ title, value, hint, accent = "text-orange-500" }: { title: string; value: string; hint?: string; accent?: string }) {
  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
      <p className="text-sm text-zinc-400">{title}</p>
      <p className={`mt-1 text-2xl font-black md:text-3xl ${accent}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

function Panel({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <section className={`rounded-3xl border border-zinc-800 bg-zinc-950 p-6 ${wide ? "xl:col-span-2" : ""}`}>
      <h2 className="text-lg font-black">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Barras horizontales de una sola serie; el valor va escrito en cada fila */
function Bars({ rows, empty = "Sin datos en el periodo." }: { rows: Row[]; empty?: string }) {
  const visible = rows.filter((r) => r.sales > 0 || r.count > 0);
  if (visible.length === 0) return <p className="text-sm text-zinc-500">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.sales), 1);
  return (
    <ul className="space-y-[2px]">
      {rows.map((r) => (
        <li
          key={r.label}
          title={`${r.label}: ${money(r.sales)} · ${r.count} pedido(s)`}
          className="group grid grid-cols-[110px_1fr_110px] items-center gap-3 rounded-lg px-1 py-1 hover:bg-zinc-900"
        >
          <span className="truncate text-xs text-zinc-400">{r.label}</span>
          <span className="h-4 rounded-r-[4px] bg-zinc-900">
            <span
              className="block h-4 rounded-r-[4px] bg-orange-500 transition-all group-hover:bg-orange-400"
              style={{ width: `${Math.max((r.sales / max) * 100, r.sales > 0 ? 1.5 : 0)}%` }}
            />
          </span>
          <span className="text-right text-xs font-bold text-zinc-200">{money(r.sales)}</span>
        </li>
      ))}
    </ul>
  );
}

function Table({ rows, first, showCosts, qty, count }: { rows: Row[]; first: string; showCosts: boolean; qty?: boolean; count?: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-zinc-500">Sin ventas en el periodo.</p>;
  const total = rows.reduce(
    (acc, r) => ({ count: acc.count + r.count, quantity: acc.quantity + r.quantity, sales: acc.sales + r.sales, cost: acc.cost + r.cost }),
    { count: 0, quantity: 0, sales: 0, cost: 0 }
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="text-left text-zinc-500">
            <th className="pb-2">{first}</th>
            {count && <th className="pb-2 text-right">Pedidos</th>}
            {qty && <th className="pb-2 text-right">Cantidad</th>}
            <th className="pb-2 text-right">Venta</th>
            {showCosts && <th className="pb-2 text-right">Costo</th>}
            {showCosts && <th className="pb-2 text-right">Utilidad</th>}
            {showCosts && <th className="pb-2 text-right">Margen</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-zinc-800">
              <td className="py-2">{r.label}</td>
              {count && <td className="py-2 text-right">{r.count}</td>}
              {qty && <td className="py-2 text-right">{num(r.quantity)}</td>}
              <td className="py-2 text-right font-bold">{money(r.sales)}</td>
              {showCosts && <td className="py-2 text-right text-zinc-400">{r.cost ? money(r.cost) : "—"}</td>}
              {showCosts && <td className="py-2 text-right">{r.cost ? money(r.profit) : "—"}</td>}
              {showCosts && <td className="py-2 text-right text-zinc-400">{r.cost ? pct(r.margin) : "—"}</td>}
            </tr>
          ))}
          <tr className="border-t-2 border-zinc-700 font-black">
            <td className="py-2">Total</td>
            {count && <td className="py-2 text-right">{total.count}</td>}
            {qty && <td className="py-2 text-right">{num(total.quantity)}</td>}
            <td className="py-2 text-right">{money(total.sales)}</td>
            {showCosts && <td className="py-2 text-right">{money(total.cost)}</td>}
            {showCosts && <td className="py-2 text-right">{money(total.sales - total.cost)}</td>}
            {showCosts && <td className="py-2 text-right">{total.sales ? pct(((total.sales - total.cost) / total.sales) * 100) : "—"}</td>}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
