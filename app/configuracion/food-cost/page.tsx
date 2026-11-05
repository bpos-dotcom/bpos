"use client";
/**
 * Tu negocio → Food cost: por producto, precio del POS, costo (receta +
 * empaque), food cost %, utilidad bruta y, cuando el periodo ya terminó,
 * utilidad neta con su parte de los gastos fijos (ver lib/food-cost.ts).
 */
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import type { Product } from "@/data/products";
import { getAdminIngredients, getAdminProducts, getAdminRecipes } from "@/lib/admin";
import { FINANCE_PERIODS, financeRanges, fixedForRange, getFixedExpenses, ymd, type FinancePeriod } from "@/lib/finance";
import {
  COST_METHODS,
  FOODCOST_EVENT,
  allocateFixed,
  fixedPerUnit,
  getFoodCostSettings,
  methodFor,
  productCost,
  saveFoodCostSettings,
  type CostMethod,
  type FoodCostSettings,
} from "@/lib/food-cost";
import { getIngredientCostHistory } from "@/lib/purchases";
import { buildReport, loadReportSources, makeCostLookup } from "@/lib/reports";

const card = "rounded-3xl border border-zinc-800 bg-zinc-950 p-5";
const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${(Number.isFinite(n) ? n : 0).toFixed(1)}%`;
const shortDay = (d: Date) => d.toLocaleDateString("es-MX", { day: "numeric", month: "short" }).replace(".", "");
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const NO_CATEGORY = "Sin categoría";

type Sort = "nombre" | "bruta" | "foodcost" | "vendidos";

export default function FoodCostPage() {
  const [period, setPeriod] = useState<FinancePeriod>("semana-pasada");
  const [custom, setCustom] = useState(() => {
    const d = new Date();
    return { from: ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 13)), to: ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1)) };
  });
  const [settings, setSettings] = useState<FoodCostSettings>({ categories: {}, products: {} });
  const [data, setData] = useState<{ products: Product[]; version: number } | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<Sort>("nombre");

  useEffect(() => {
    const load = () => {
      setSettings(getFoodCostSettings());
      setData((d) => ({ products: getAdminProducts(), version: (d?.version || 0) + 1 }));
    };
    load();
    window.addEventListener(FOODCOST_EVENT, load);
    window.addEventListener("bpos:orders-updated", load);
    window.addEventListener("bpos:inventory-updated", load);
    return () => {
      window.removeEventListener(FOODCOST_EVENT, load);
      window.removeEventListener("bpos:orders-updated", load);
      window.removeEventListener("bpos:inventory-updated", load);
    };
  }, []);

  const range = useMemo(() => financeRanges(period, custom).main, [period, custom]);
  // La utilidad neta se calcula solo con el periodo terminado (ya se sabe cuántas piezas salieron)
  const today = new Date();
  const finished = range.to.getTime() <= new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

  const calc = useMemo(() => {
    if (!data) return null;
    const recipes = getAdminRecipes();
    const ingredients = new Map(getAdminIngredients().map((i) => [Number(i.id), i]));
    const costAt = makeCostLookup(getIngredientCostHistory());
    const sellable = data.products.filter((p) => !p.notSoldAlone);
    // Piezas vendidas en el periodo (la venta del producto, no sus partes dentro de un combo)
    const units = new Map<number, number>();
    for (const o of buildReport(loadReportSources(), range).orders) for (const i of o.items || []) units.set(Number(i.id), (units.get(Number(i.id)) || 0) + (Number(i.quantity) || 0));
    const rows = sellable.map((p) => {
      const c = productCost(p, recipes, ingredients, (id) => costAt(id));
      const price = Number(p.price) || 0;
      return { p, price, cost: c, units: units.get(Number(p.id)) || 0, method: methodFor(p, settings), gross: price - c.total };
    });
    const fixedMonthly = getFixedExpenses().reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const fixed = fixedForRange(fixedMonthly, range);
    const alloc = allocateFixed(fixed, rows.map((r) => ({ units: r.units, price: r.price, method: r.method })));
    return { rows: rows.map((r) => ({ ...r, net: r.gross - fixedPerUnit(r.price, r.method, alloc) })), fixed, alloc };
  }, [data, range, settings]);

  function setCategoryMethod(c: string, m: CostMethod) {
    const next = { ...settings, categories: { ...settings.categories, [c]: m } };
    if (m === "pieza") delete next.categories[c];
    setSettings(next);
    saveFoodCostSettings(next);
  }
  function setProductMethod(id: number, m: CostMethod | "") {
    const next = { ...settings, products: { ...settings.products } };
    if (m) next.products[String(id)] = m;
    else delete next.products[String(id)];
    setSettings(next);
    saveFoodCostSettings(next);
  }

  const rows = calc?.rows || [];
  const categories = [...new Set(rows.map((r) => r.p.category || NO_CATEGORY))].sort((a, b) => a.localeCompare(b, "es"));
  const q = plain(query.trim());
  const shown = rows.filter((r) => (!category || (r.p.category || NO_CATEGORY) === category) && (!q || plain(r.p.name).includes(q)));
  const sorter = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
    sort === "bruta" ? b.gross - a.gross : sort === "foodcost" ? (b.price ? b.cost.total / b.price : 0) - (a.price ? a.cost.total / a.price : 0) : sort === "vendidos" ? b.units - a.units : a.p.name.localeCompare(b.p.name, "es");
  const groups = categories.map((c) => [c, shown.filter((r) => (r.p.category || NO_CATEGORY) === c).sort(sorter)] as const).filter(([, list]) => list.length);

  const sold = rows.filter((r) => r.units > 0);
  const totals = {
    units: sold.reduce((s, r) => s + r.units, 0),
    sales: sold.reduce((s, r) => s + r.units * r.price, 0),
    cost: sold.reduce((s, r) => s + r.units * r.cost.total, 0),
    gross: sold.reduce((s, r) => s + r.units * r.gross, 0),
    net: sold.reduce((s, r) => s + r.units * r.net, 0),
  };
  const noRecipe = rows.filter((r) => r.cost.noRecipe).length;

  return (
    <AppShell title="Food cost" subtitle="Cuánto te cuesta hacer cada producto y cuánto te deja, antes y después de los gastos fijos.">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          {FINANCE_PERIODS.map(([key, text]) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={`rounded-2xl border px-4 py-2 text-sm font-black ${period === key ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-800 text-zinc-300 hover:border-zinc-600"}`}
            >
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
            {shortDay(range.from)} a {shortDay(new Date(range.to.getTime() - 86_400_000))}
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className={card}>
            <p className="text-sm text-zinc-400">Gastos fijos del periodo</p>
            <p className="text-3xl font-black">{money(calc?.fixed || 0)}</p>
            <p className="mt-1 text-xs text-zinc-500">Su parte de los fijos del mes (Finanzas → Gastos fijos)</p>
          </div>
          <div className={card}>
            <p className="text-sm text-zinc-400">Piezas vendidas</p>
            <p className="text-3xl font-black">{totals.units}</p>
            <p className="mt-1 text-xs text-zinc-500">{money(totals.sales)} a precio del POS</p>
          </div>
          <div className={card}>
            <p className="text-sm text-zinc-400">Gasto fijo que carga cada pieza</p>
            <p className="text-3xl font-black text-orange-400">{finished && calc?.alloc.pieceUnits ? money(calc.alloc.perPiece) : "–"}</p>
            <p className="mt-1 text-xs text-zinc-500">
              {finished ? `Entre ${calc?.alloc.pieceUnits || 0} piezas "por pieza"` : "Se calcula cuando termina el periodo"}
              {finished && calc?.alloc.pctRate ? ` · los "por porcentaje" cargan ${pct(calc.alloc.pctRate * 100)} de su precio` : ""}
            </p>
          </div>
          <div className={card}>
            <p className="text-sm text-zinc-400">Lo vendido dejó</p>
            <p className="text-3xl font-black text-emerald-400">{money(totals.gross)}</p>
            <p className="mt-1 text-xs text-zinc-500">
              Utilidad bruta (food cost {pct(totals.sales ? (totals.cost / totals.sales) * 100 : 0)}) · neta {finished ? money(totals.net) : "–"}
            </p>
          </div>
        </div>

        {!finished && (
          <p className="rounded-2xl border border-sky-500/40 bg-sky-500/10 p-3 text-sm text-sky-200">
            La utilidad neta sale con “–” porque el periodo todavía no termina: falta saber cuántas piezas van a salir para repartir los gastos fijos. Elige Semana pasada, Mes pasado o un rango que ya terminó.
          </p>
        )}
        {noRecipe > 0 && (
          <p className="rounded-2xl border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-100">
            ⚠️ {noRecipe} producto{noRecipe === 1 ? "" : "s"} sin receta ni empaque: su costo sale en $0. Agrégalos en Tu negocio → Productos.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔎 Buscar producto" className="min-w-0 flex-1 rounded-2xl border border-zinc-800 bg-black px-4 py-3" />
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-2xl border border-zinc-800 bg-black px-4 py-3" aria-label="Categoría">
            <option value="">Todas las categorías</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-2xl border border-zinc-800 bg-black px-4 py-3" aria-label="Ordenar">
            <option value="nombre">Por nombre</option>
            <option value="bruta">Los que más dejan</option>
            <option value="foodcost">Food cost más alto</option>
            <option value="vendidos">Más vendidos</option>
          </select>
        </div>

        {groups.map(([c, list]) => {
          const catMethod = settings.categories[c] || "pieza";
          return (
            <section key={c} className={card}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-black">
                  {c} <span className="text-sm font-bold text-zinc-500">· {list.length}</span>
                </h2>
                <label className="flex items-center gap-2 text-xs font-bold text-zinc-400">
                  Gasto fijo de la categoría
                  <select value={catMethod} onChange={(e) => setCategoryMethod(c, e.target.value as CostMethod)} className="rounded-xl border border-zinc-700 bg-black px-2 py-1.5 text-sm text-white" aria-label={`Cómo carga el gasto fijo ${c}`}>
                    {COST_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="text-left text-xs text-zinc-500">
                    <tr>
                      <th className="py-2 pr-3">Producto</th>
                      <th className="py-2 pr-3 text-right">Vendidos</th>
                      <th className="py-2 pr-3 text-right">Precio</th>
                      <th className="py-2 pr-3 text-right">Costo</th>
                      <th className="py-2 pr-3 text-right">Food cost</th>
                      <th className="py-2 pr-3 text-right">Utilidad bruta</th>
                      <th className="py-2 text-right">Utilidad neta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => {
                      const fc = r.price > 0 ? (r.cost.total / r.price) * 100 : 0;
                      // Sin costo todavía (insumos sin compra): no se muestra un 0% engañoso
                      const unknown = r.cost.noRecipe || (r.cost.total === 0 && r.cost.missing.length > 0);
                      const own = settings.products[String(r.p.id)] || "";
                      return (
                        <tr key={r.p.id} className="border-t border-zinc-800 align-top">
                          <td className="py-2 pr-3">
                            <p className="font-black">{r.p.name}</p>
                            <select
                              value={own}
                              onChange={(e) => setProductMethod(r.p.id, e.target.value as CostMethod | "")}
                              className="mt-1 rounded-lg border border-zinc-800 bg-black px-1.5 py-0.5 text-[11px] text-zinc-400"
                              aria-label={`Cómo carga el gasto fijo ${r.p.name}`}
                            >
                              <option value="">Gasto fijo: como su categoría</option>
                              {COST_METHODS.map((m) => (
                                <option key={m.value} value={m.value}>
                                  Gasto fijo: {m.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 pr-3 text-right font-bold">{r.units || <span className="text-zinc-600">0</span>}</td>
                          <td className="py-2 pr-3 text-right font-bold">{money(r.price)}</td>
                          <td className="py-2 pr-3 text-right">
                            {r.cost.noRecipe ? (
                              <span className="font-black text-yellow-300">Sin receta</span>
                            ) : (
                              <>
                                <b>{money(r.cost.total)}</b>
                                {r.cost.packaging > 0 && <span className="block text-[11px] text-zinc-500">empaque {money(r.cost.packaging)}</span>}
                                {r.cost.missing.length > 0 && <span className="block text-[11px] text-yellow-300" title={r.cost.missing.join(", ")}>sin costo: {r.cost.missing.slice(0, 2).join(", ")}{r.cost.missing.length > 2 ? "…" : ""}</span>}
                              </>
                            )}
                          </td>
                          <td className={`py-2 pr-3 text-right font-black ${unknown ? "text-zinc-600" : fc > 35 ? "text-red-400" : "text-emerald-400"}`}>{unknown ? "–" : pct(fc)}</td>
                          <td className="py-2 pr-3 text-right font-black">{money(r.gross)}</td>
                          <td className={`py-2 text-right font-black ${finished ? (r.net >= 0 ? "text-emerald-400" : "text-red-400") : "text-zinc-500"}`}>{finished ? money(r.net) : "–"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
        {groups.length === 0 && <p className="py-8 text-center text-zinc-500">{rows.length ? "Nada con esa búsqueda." : "Aún no hay productos."}</p>}
        <p className="text-xs text-zinc-500">
          Costo = receta + empaque de 1 pieza, con el precio de tu última compra de cada insumo. En combos cuenta lo obligatorio que llevan dentro (el promedio de sus opciones). Por pieza: cada pieza vendida carga lo mismo del gasto fijo; por porcentaje: carga según su precio; no carga: los demás absorben su parte.
        </p>
      </div>
    </AppShell>
  );
}
