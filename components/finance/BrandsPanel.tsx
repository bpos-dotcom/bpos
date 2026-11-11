"use client";
/**
 * Finanzas → Por marca (multimarca, Configuración → Marcas): cuánto vendió
 * cada marca, por canal ("DiDi Food (Supremos)"), su ingreso, su food cost
 * y su utilidad bruta. El ingreso de las apps es estimado con las comisiones
 * de ⚙️ Comisiones de apps (los depósitos reales no vienen por marca); los
 * gastos fijos son del negocio y no se reparten.
 */
import { isConfigured, netFactor, type AppCommission } from "@/lib/app-commissions";
import type { ReportData } from "@/lib/reports";

type Props = {
  rows: ReportData["byBrand"];
  mixed: ReportData["mixedBrandOrders"];
  periodName: string;
  money: (n: number) => string;
  pct: (n: number) => string;
  commissions: Record<string, AppCommission>;
};

export function BrandsPanel({ rows, mixed, periodName, money, pct, commissions }: Props) {
  const brands = rows.map((r) => {
    let income = 0;
    let unconfigured = false;
    for (const c of r.channels) {
      if (!c.app) income += c.sales;
      else if (isConfigured(commissions[c.app])) income += c.sales * netFactor(commissions[c.app]);
      else {
        income += c.sales;
        unconfigured = true;
      }
    }
    const appSales = r.channels.filter((c) => c.app).reduce((s, c) => s + c.sales, 0);
    return { ...r, income, unconfigured, appSales, foodCost: income > 0 ? (r.cost / income) * 100 : 0, gross: income - r.cost };
  });
  const totalSales = brands.reduce((s, b) => s + b.sales, 0);
  const leader = [...brands].sort((a, b) => b.sales - a.sales)[0];
  const bestMargin = [...brands].filter((b) => b.income > 0).sort((a, b) => a.foodCost - b.foodCost)[0];

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black">🏷️ Por marca</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Lo que vendió cada marca {periodName}, por canal. El ingreso de las apps es estimado con tus comisiones (lo vendido menos lo que se quedan); los gastos fijos son del negocio y no se reparten.
          </p>
        </div>
        {totalSales > 0 && leader && (
          <div className="text-right text-sm">
            <p className="font-black text-orange-300">🏆 {leader.label} vendió más</p>
            {bestMargin && brands.length > 1 && <p className="text-xs text-zinc-400">Mejor food cost: {bestMargin.label} ({pct(bestMargin.foodCost)})</p>}
          </div>
        )}
      </div>

      {totalSales > 0 && (
        <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-zinc-900" role="img" aria-label="Parte de la venta de cada marca">
          {brands
            .filter((b) => b.sales > 0)
            .map((b) => (
              <span key={b.brandId} title={`${b.label}: ${pct((b.sales / totalSales) * 100)}`} style={{ width: `${(b.sales / totalSales) * 100}%`, background: b.color }} className="border-r-2 border-zinc-950 last:border-r-0" />
            ))}
        </div>
      )}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {brands.map((b) => (
          <div key={b.brandId} className="rounded-2xl border border-zinc-800 bg-black p-4">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ background: b.color }} />
              <p className="flex-1 font-black">{b.label}</p>
              <p className="text-sm text-zinc-400">
                {b.count} pedido{b.count === 1 ? "" : "s"}
                {totalSales > 0 ? ` · ${pct((b.sales / totalSales) * 100)} de la venta` : ""}
              </p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs text-zinc-500">Venta</p>
                <p className="font-black">{money(b.sales)}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Ingreso{b.appSales > 0 ? " (estimado)" : ""}</p>
                <p className="font-black">{money(b.income)}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Food cost</p>
                <p className="font-black">
                  {money(b.cost)} <span className="text-xs text-zinc-400">{pct(b.foodCost)}</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Utilidad bruta</p>
                <p className={`font-black ${b.gross < 0 ? "text-red-300" : "text-emerald-300"}`}>{money(b.gross)}</p>
              </div>
            </div>
            {b.channels.length > 0 ? (
              <div className="mt-3 space-y-1">
                {b.channels.map((c) => (
                  <div key={c.label} className="flex items-center justify-between gap-2 rounded-xl bg-zinc-950 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate">
                      {c.app ? "🛵" : "🏪"} {c.label} ({b.label})
                    </span>
                    <span className="shrink-0 text-zinc-300">
                      {c.count} · <span className="font-black text-white">{money(c.sales)}</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-zinc-500">Sin ventas {periodName}.</p>
            )}
            {b.unconfigured && <p className="mt-2 text-xs text-amber-300">Sin comisiones configuradas para alguna app: su ingreso se cuenta completo. Configúralas en ⚙️ Comisiones de apps.</p>}
          </div>
        ))}
      </div>

      {mixed.length > 0 && (
        <div className="mt-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <p className="font-black text-amber-200">⚠️ {mixed.length} pedido(s) con productos de dos marcas</p>
          <p className="mt-1 text-xs text-amber-100/80">Cuentan en la marca que más vendió. Revisa la marca de sus productos en Configuración → Marcas o la equivalencia del Bridge.</p>
          <ul className="mt-2 space-y-1">
            {mixed.slice(0, 8).map((o) => (
              <li key={String(o.id)} className="text-amber-100">
                {new Date(o.createdAt).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {o.channel} · {money(o.total)} · {o.brands.join(" + ")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
