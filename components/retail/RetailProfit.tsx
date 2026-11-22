"use client";
/**
 * Tienda y ferretería → Tu negocio → Utilidad: qué artículo deja más.
 * (En el restaurante esta misma pantalla es Food cost.)
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Product } from "@/data/products";
import { getAdminProducts } from "@/lib/admin";
import { FINANCE_PERIODS, financeRanges, fixedForRange, getFixedExpenses, ymd, type FinancePeriod } from "@/lib/finance";
import { getIngredientCostHistory } from "@/lib/purchases";
import { buildReport, loadReportSources } from "@/lib/reports";
import { formatQty, unitOf } from "@/lib/retail";
import { retailProfit, type ProfitRow } from "@/lib/retail-profit";

const card = "rounded-3xl border border-zinc-800 bg-zinc-950 p-5";
const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const shortDay = (d: Date) => d.toLocaleDateString("es-MX", { day: "numeric", month: "short" }).replace(".", "");

type Sort = "ganancia" | "margen" | "vendidos" | "nombre";
const SORTS: [Sort, string][] = [
  ["ganancia", "Lo que más deja"],
  ["margen", "Mayor margen"],
  ["vendidos", "Más vendidos"],
  ["nombre", "Nombre"],
];

export function RetailProfit() {
  const [period, setPeriod] = useState<FinancePeriod>("semana-pasada");
  const [custom, setCustom] = useState(() => {
    const d = new Date();
    return { from: ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 13)), to: ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1)) };
  });
  const [version, setVersion] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [sort, setSort] = useState<Sort>("ganancia");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");

  useEffect(() => {
    const load = () => {
      setProducts(getAdminProducts());
      setVersion((v) => v + 1);
    };
    load();
    window.addEventListener("bpos:orders-updated", load);
    window.addEventListener("bpos:inventory-updated", load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener("bpos:orders-updated", load);
      window.removeEventListener("bpos:inventory-updated", load);
      window.removeEventListener("storage", load);
    };
  }, []);

  const range = useMemo(() => financeRanges(period, custom).main, [period, custom]);
  const calc = useMemo(() => {
    if (!version) return null;
    // Costo: el del artículo; si no tiene, el de su última compra
    const history = getIngredientCostHistory();
    const lastCost = (id?: number) => {
      if (!id) return null;
      const list = history.filter((h) => Number(h.ingredientId) === Number(id) && !h.occasional);
      return list.length ? list[list.length - 1].unitCost : null;
    };
    const orders = buildReport(loadReportSources(), range).orders;
    const result = retailProfit(products, orders, (p) => (p.cost && p.cost > 0 ? p.cost : lastCost(p.stockItemId)));
    const fixed = fixedForRange(getFixedExpenses().reduce((s, e) => s + (Number(e.amount) || 0), 0), range);
    return { ...result, fixed };
  }, [products, range, version]);

  const rows = calc?.rows || [];
  const categories = [...new Set(rows.map((r) => r.product.category || "Sin categoría"))].sort((a, b) => a.localeCompare(b, "es"));
  const q = plain(query.trim());
  const by = (a: ProfitRow, b: ProfitRow) =>
    sort === "ganancia"
      ? (b.profit ?? -Infinity) - (a.profit ?? -Infinity) || (b.unitProfit ?? -Infinity) - (a.unitProfit ?? -Infinity)
      : sort === "margen"
        ? (b.margin ?? -Infinity) - (a.margin ?? -Infinity)
        : sort === "vendidos"
          ? b.sales - a.sales
          : a.product.name.localeCompare(b.product.name, "es");
  const shown = rows.filter((r) => (!category || (r.product.category || "Sin categoría") === category) && (!q || plain(`${r.product.name} ${r.product.barcode || ""}`).includes(q))).sort(by);
  const t = calc?.totals;
  const net = t ? t.profit - (calc?.fixed || 0) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {FINANCE_PERIODS.map(([key, text]) => (
          <button key={key} onClick={() => setPeriod(key)} className={`rounded-2xl border px-4 py-2 text-sm font-black ${period === key ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-800 text-zinc-300 hover:border-zinc-600"}`}>
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
          <p className="text-sm text-zinc-400">Vendiste</p>
          <p className="text-3xl font-black">{money(t?.sales || 0)}</p>
          {t && t.discounts > 0 && <p className="mt-1 text-xs text-zinc-500">Descuentos: {money(t.discounts)}</p>}
        </div>
        <div className={card}>
          <p className="text-sm text-zinc-400">Te dejó (ganancia)</p>
          <p className="text-3xl font-black text-green-400">{money(t?.profit || 0)}</p>
          {t && t.salesWithoutCost > 0 && <p className="mt-1 text-xs text-yellow-300">Sin contar {money(t.salesWithoutCost)} de artículos sin costo.</p>}
        </div>
        <div className={card}>
          <p className="text-sm text-zinc-400">Gastos fijos del periodo</p>
          <p className="text-3xl font-black">{money(calc?.fixed || 0)}</p>
          <p className="mt-1 text-xs text-zinc-500">
            Renta, luz, sueldos… en <Link href="/finanzas" className="text-orange-400 underline">Finanzas</Link>
          </p>
        </div>
        <div className={card}>
          <p className="text-sm text-zinc-400">Utilidad neta</p>
          <p className={`text-3xl font-black ${net >= 0 ? "text-green-400" : "text-red-400"}`}>{money(net)}</p>
          <p className="mt-1 text-xs text-zinc-500">Ganancia menos gastos fijos</p>
        </div>
      </div>

      {t && t.missingCost > 0 && (
        <p className="rounded-2xl border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-yellow-100">
          {t.missingCost} artículo(s) no tienen costo: ponlo en <Link href="/configuracion/productos" className="font-black underline">Artículos</Link> o registra su compra en{" "}
          <Link href="/compras" className="font-black underline">Compras</Link> para saber cuánto te dejan.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 Buscar artículo" className="rounded-2xl border border-zinc-800 bg-black px-4 py-2" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-2xl border border-zinc-800 bg-black px-4 py-2">
          <option value="">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        {SORTS.map(([key, text]) => (
          <button key={key} onClick={() => setSort(key)} className={`rounded-2xl border px-3 py-2 text-sm font-black ${sort === key ? "border-orange-500 text-orange-300" : "border-zinc-800 text-zinc-400"}`}>
            {text}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-3xl border border-zinc-800 bg-zinc-950">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-zinc-500">
            <tr>
              <th className="p-3">Artículo</th>
              <th className="p-3 text-right">Precio</th>
              <th className="p-3 text-right">Costo</th>
              <th className="p-3 text-right">Deja c/u</th>
              <th className="p-3 text-right">Margen</th>
              <th className="p-3 text-right">Vendido</th>
              <th className="p-3 text-right">Ventas</th>
              <th className="p-3 text-right">Te dejó</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.product.id} className="border-t border-zinc-800">
                <td className="p-3">
                  <span className="font-black">{r.product.name}</span>
                  <span className="block text-xs text-zinc-500">{r.product.category}</span>
                </td>
                <td className="p-3 text-right">{r.product.openPrice ? "Libre" : money(Number(r.product.price) || 0)}</td>
                <td className="p-3 text-right">{r.cost !== null ? money(r.cost) : <span className="text-yellow-300">{r.product.openPrice ? "–" : "Falta"}</span>}</td>
                <td className={`p-3 text-right font-bold ${r.unitProfit !== null && r.unitProfit < 0 ? "text-red-400" : ""}`}>{r.unitProfit !== null ? money(r.unitProfit) : "–"}</td>
                <td className={`p-3 text-right ${r.margin !== null ? (r.margin < 10 ? "text-red-400" : r.margin < 25 ? "text-yellow-300" : "text-green-400") : ""}`}>{r.margin !== null ? `${r.margin}%` : "–"}</td>
                <td className="p-3 text-right">{r.sold ? formatQty(r.sold, unitOf(r.product)) : "–"}</td>
                <td className="p-3 text-right">{r.sales ? money(r.sales) : "–"}</td>
                <td className={`p-3 text-right text-base font-black ${r.profit === null ? "text-zinc-500" : r.profit < 0 ? "text-red-400" : "text-green-400"}`}>{r.profit !== null && r.sold ? money(r.profit) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="p-8 text-center text-zinc-500">No hay artículos.</p>}
      </div>
    </div>
  );
}
