"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import RequirePermission from "@/components/auth/RequirePermission";
import { isPackaging, type Ingredient, type RecipeItem } from "@/data/inventory";
import type { Product } from "@/data/products";
import { getAdminProducts, getAdminRecipes } from "@/lib/admin";
import { getInventory, getKardex, type InventoryMovement } from "@/lib/inventory";
import { getCurrentUser } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { mergeOrders } from "@/lib/order-archive";
import { archivedNotice, useArchivedOrders } from "@/lib/use-archived-orders";
import {
  equivalenceWarnings,
  expectedUse,
  periodMoves,
  proposeEquivalence,
  roundQty,
  salesInRange,
  stockAt,
  type EquivalenceOrder,
  type EquivalenceProposal,
} from "@/lib/recipe-equivalence";
import {
  applyEquivalence,
  getEquivalenceLog,
  getEquivalencePicks,
  saveEquivalencePicks,
  undoEquivalence,
  type EquivalenceLogEntry,
} from "@/lib/recipe-equivalence-store";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const longDay = (d: Date) => d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "short" });

/** Lunes a domingo de la semana pasada */
function lastWeek(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  return { from: addDays(monday, -7), to: addDays(monday, -1) };
}

const fmt = (n: number, unit: string) => `${Number.isFinite(n) ? roundQty(n, unit as Ingredient["unit"]).toLocaleString("es-MX", { maximumFractionDigits: 4 }) : "—"} ${unit}`;

type Pick = "sistema" | "personalizado";
type RowInput = { start: Pick; startValue: string; end: Pick; endValue: string; extraPurchases: string };
const defaultRow = (): RowInput => ({ start: "sistema", startValue: "", end: "sistema", endValue: "", extraPurchases: "" });

export default function EquivaladorPage() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [kardex, setKardex] = useState<InventoryMovement[]>([]);
  const [recipes, setRecipes] = useState<RecipeItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<EquivalenceOrder[]>([]);
  const [log, setLog] = useState<EquivalenceLogEntry[]>([]);
  const [picks, setPicks] = useState<number[]>([]);
  const [rows, setRows] = useState<Record<number, RowInput>>({});
  const initial = lastWeek();
  const [fromText, setFromText] = useState(ymd(initial.from));
  const [toText, setToText] = useState(ymd(initial.to));
  const [adding, setAdding] = useState("");

  function load() {
    setIngredients(getInventory());
    setKardex(getKardex());
    setRecipes(getAdminRecipes());
    setProducts(getAdminProducts());
    setLog(getEquivalenceLog());
    try {
      setOrders(JSON.parse(localStorage.getItem("bpos_orders") || "[]"));
    } catch {
      setOrders([]);
    }
  }

  useEffect(() => {
    // Se lee al montar (después de pintar) para no chocar con lo que viene del servidor
    Promise.resolve().then(() => {
      load();
      setPicks(getEquivalencePicks());
    });
    const on = () => load();
    window.addEventListener("bpos:inventory-updated", on);
    window.addEventListener("bpos:orders-updated", on);
    return () => {
      window.removeEventListener("bpos:inventory-updated", on);
      window.removeEventListener("bpos:orders-updated", on);
    };
  }, []);

  const fromDay = parseYmd(fromText);
  const toDay = parseYmd(toText);
  const validRange = Boolean(fromDay && toDay && fromDay.getTime() <= toDay.getTime());
  const from = fromDay || initial.from;
  const endExclusive = addDays(toDay || initial.to, 1);
  const fromMs = from.getTime();
  const endMs = endExclusive.getTime();
  const archived = useArchivedOrders(validRange ? from : null, validRange ? endExclusive : null);
  const sales = useMemo(() => (validRange ? salesInRange(mergeOrders(orders, archived.orders as EquivalenceOrder[]), new Date(fromMs), new Date(endMs)) : []), [orders, archived.orders, validRange, fromMs, endMs]);

  // Insumos que sale a cuenta equivaler: los que lleva alguna receta u opción
  const usedIds = useMemo(() => {
    const ids = new Set(recipes.map((r) => Number(r.ingredientId)));
    for (const p of products) for (const g of p.modifierGroups || []) for (const o of g.options || []) if (o.ingredientId) ids.add(Number(o.ingredientId));
    return ids;
  }, [recipes, products]);
  const candidates = ingredients.filter((i) => !isPackaging(i) && usedIds.has(Number(i.id)) && !picks.includes(Number(i.id))).sort((a, b) => a.name.localeCompare(b.name));
  const picked = picks.map((id) => ingredients.find((i) => Number(i.id) === id)).filter((i): i is Ingredient => Boolean(i));

  function setPicked(next: number[]) {
    setPicks(next);
    saveEquivalencePicks(next);
  }

  function quick(kind: "pasada" | "esta" | "7") {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (kind === "pasada") {
      const w = lastWeek(now);
      setFromText(ymd(w.from));
      setToText(ymd(w.to));
    } else if (kind === "esta") {
      setFromText(ymd(addDays(today, -((today.getDay() + 6) % 7))));
      setToText(ymd(today));
    } else {
      setFromText(ymd(addDays(today, -7)));
      setToText(ymd(addDays(today, -1)));
    }
  }

  const done = log.filter((e) => !e.undoneAt).slice(0, 20);

  return (
    <RequirePermission permission="inventory.view">
      <AppShell title="Equivalador de insumos" subtitle="Repara las recetas de lo que se sirve a ojo (lechuga, tomate, cátsup...) con lo que de verdad se gastó.">
        <Link href="/inventario" className="text-sm font-black text-zinc-400 hover:text-orange-400">
          ← Inventario
        </Link>

        <section className="mt-4 rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
          <h2 className="text-lg font-black text-orange-500">1. Fechas</h2>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-sm text-zinc-400">
              Desde
              <input type="date" value={fromText} onChange={(e) => setFromText(e.target.value)} className="mt-1 block rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white" />
            </label>
            <label className="text-sm text-zinc-400">
              Hasta (incluido)
              <input type="date" value={toText} onChange={(e) => setToText(e.target.value)} className="mt-1 block rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white" />
            </label>
            <div className="flex flex-wrap gap-2">
              {([["pasada", "Semana pasada"], ["esta", "Esta semana"], ["7", "Últimos 7 días"]] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => quick(k)} className="rounded-xl border border-zinc-700 px-3 py-2 text-sm font-bold text-zinc-300 hover:border-orange-500">
                  {label}
                </button>
              ))}
            </div>
          </div>
          {validRange ? (
            <p className="mt-3 text-sm text-zinc-400">
              Del <b className="text-white">{longDay(from)}</b> al <b className="text-white">{longDay(addDays(endExclusive, -1))}</b> · {sales.length} ventas cobradas
            </p>
          ) : (
            <p className="mt-3 text-sm font-bold text-red-400">La fecha &quot;desde&quot; debe ser antes de &quot;hasta&quot;.</p>
          )}
          {archivedNotice(archived) && <p className={`mt-2 text-sm font-bold ${archived.error ? "text-red-400" : "text-sky-400"}`}>{archivedNotice(archived)}</p>}
        </section>

        <section className="mt-4 rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
          <h2 className="text-lg font-black text-orange-500">2. Insumos que se sirven a ojo</h2>
          <p className="mt-1 text-sm text-zinc-400">Se quedan guardados para la próxima vez.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <select value={adding} onChange={(e) => setAdding(e.target.value)} className="rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white">
              <option value="">Agregar insumo…</option>
              {candidates.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.unit})
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!adding}
              onClick={() => {
                setPicked([...picks, Number(adding)]);
                setAdding("");
              }}
              className="rounded-2xl bg-orange-500 px-5 py-3 font-black text-black disabled:opacity-40"
            >
              Agregar
            </button>
          </div>
          {!picked.length && <p className="mt-3 text-sm text-zinc-500">Todavía no eliges ninguno. Solo salen los insumos que lleva alguna receta.</p>}
        </section>

        {validRange &&
          picked.map((ing) => (
            <IngredientRow
              key={ing.id}
              ingredient={ing}
              input={rows[ing.id] || defaultRow()}
              onInput={(next) => setRows((r) => ({ ...r, [ing.id]: next }))}
              onRemove={() => setPicked(picks.filter((id) => id !== Number(ing.id)))}
              kardex={kardex}
              sales={sales}
              recipes={recipes}
              products={products}
              from={from}
              endExclusive={endExclusive}
              cloudLoading={archived.loading}
              onApplied={() => {
                setRows((r) => ({ ...r, [ing.id]: defaultRow() }));
                load();
              }}
            />
          ))}

        {done.length > 0 && (
          <section className="mt-4 rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
            <h2 className="text-lg font-black text-orange-500">Equivalados anteriores</h2>
            <div className="mt-3 space-y-2">
              {done.map((e) => (
                <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-black p-3 text-sm">
                  <div>
                    <p className="font-black">
                      {e.ingredientName}{" "}
                      {e.factor > 0 && (
                        <span className={e.factor >= 1 ? "text-amber-400" : "text-emerald-400"}>
                          {e.factor >= 1 ? "+" : ""}
                          {Math.round((e.factor - 1) * 100)}%
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {new Date(e.createdAt).toLocaleString("es-MX")} · {e.from} a {e.to} · {e.recipeChanges.length + e.optionChanges.length} recetas/opciones{e.userName ? ` · ${e.userName}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!(await requirePermission(getCurrentUser(), "recipes.manage", "regresar recetas"))) return;
                      if (!window.confirm(`¿Regresar las recetas de ${e.ingredientName} a como estaban antes de este equivalado? (La existencia no se toca.)`)) return;
                      undoEquivalence(e.id);
                      load();
                    }}
                    className="rounded-xl border border-zinc-700 px-3 py-2 text-xs font-black text-zinc-300 hover:border-orange-500"
                  >
                    ↩ Regresar a como estaba
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </AppShell>
    </RequirePermission>
  );
}

function IngredientRow(props: {
  ingredient: Ingredient;
  input: RowInput;
  onInput: (next: RowInput) => void;
  onRemove: () => void;
  kardex: InventoryMovement[];
  sales: EquivalenceOrder[];
  recipes: RecipeItem[];
  products: Product[];
  from: Date;
  endExclusive: Date;
  cloudLoading: boolean;
  onApplied: () => void;
}) {
  const { ingredient: ing, input, onInput, kardex, sales, recipes, products, from, endExclusive } = props;
  const [confirming, setConfirming] = useState(false);
  const [fixStock, setFixStock] = useState(true);
  const u = ing.unit;
  const id = Number(ing.id);

  const systemStart = stockAt(kardex, id, from, ing.stock);
  const systemEnd = stockAt(kardex, id, endExclusive, ing.stock);
  const moves = periodMoves(kardex, id, from, endExclusive);
  const extra = Number(input.extraPurchases) || 0;
  const purchases = moves.purchases + extra;
  const start = input.start === "personalizado" ? Number(input.startValue) : systemStart;
  const end = input.end === "personalizado" ? Number(input.endValue) : systemEnd;
  const missing = (input.start === "personalizado" && input.startValue.trim() === "") || (input.end === "personalizado" && input.endValue.trim() === "");
  const expected = useMemo(() => expectedUse(sales, id, recipes), [sales, id, recipes]);
  const realUse = start + purchases - moves.waste - end;
  const shouldRemain = start + purchases - moves.waste - expected.total;
  const proposal: EquivalenceProposal = missing ? { mode: "ninguno", factor: 1, recipeChanges: [], optionChanges: [], reason: "Escribe el número personalizado." } : proposeEquivalence({ ingredient: ing, realUse, expected, recipes, products });
  const warnings = missing ? [] : equivalenceWarnings({ realUse, expected, proposal, endIsSystem: input.end === "sistema", manualIn: moves.manualIn, manualOut: moves.manualOut, unit: u });
  const changes = proposal.recipeChanges.filter((c) => c.to !== c.from).length + proposal.optionChanges.filter((c) => c.to !== c.from).length;
  const pct = expected.total > 0 ? (realUse / expected.total - 1) * 100 : null;
  // Lo que el conteo dice que falta (o sobra) contra el sistema, para corregir la existencia de ahora
  const stockFix = input.end === "personalizado" && !missing ? roundQty(end - systemEnd, u) : 0;
  const soldRows = [...expected.units.entries()].map(([pid, n]) => ({ name: products.find((p) => Number(p.id) === pid)?.name || `Producto ${pid}`, n })).sort((a, b) => b.n - a.n);

  const pickBox = (label: string, which: "start" | "end", system: number, hint: string) => {
    const mode = which === "start" ? input.start : input.end;
    const value = which === "start" ? input.startValue : input.endValue;
    return (
      <div className="rounded-2xl border border-zinc-800 bg-black p-3">
        <p className="text-xs font-bold text-zinc-400">{label}</p>
        <select
          value={mode}
          onChange={(e) => onInput({ ...input, [which]: e.target.value as Pick })}
          className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm font-bold text-white"
        >
          <option value="sistema">Según el sistema: {fmt(system, u)}</option>
          <option value="personalizado">Personalizado</option>
        </select>
        {mode === "personalizado" && (
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            value={value}
            onChange={(e) => onInput({ ...input, [which === "start" ? "startValue" : "endValue"]: e.target.value })}
            placeholder={`Cantidad en ${u}`}
            className="mt-2 w-full rounded-xl border border-orange-500/60 bg-zinc-950 px-3 py-2 text-white"
          />
        )}
        <p className="mt-1 text-[11px] text-zinc-500">{hint}</p>
      </div>
    );
  };

  async function apply() {
    if (!(await requirePermission(getCurrentUser(), "recipes.manage", "cambiar recetas"))) return;
    applyEquivalence({
      ingredientId: id,
      ingredientName: ing.name,
      unit: u,
      from: ymd(from),
      to: ymd(addDays(endExclusive, -1)),
      realUse: roundQty(realUse, u),
      expectedUse: roundQty(expected.total, u),
      factor: proposal.mode === "proporcional" ? proposal.factor : 0,
      recipeChanges: proposal.recipeChanges.filter((c) => c.to !== c.from),
      optionChanges: proposal.optionChanges.filter((c) => c.to !== c.from),
      ...(fixStock && stockFix ? { stockFix } : {}),
    });
    setConfirming(false);
    props.onApplied();
    alert(`Listo: se equivalaron ${changes} recetas/opciones de ${ing.name}.`);
  }

  return (
    <section className="mt-4 rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-black">
          {ing.name} <span className="text-sm font-bold text-zinc-500">({u})</span>
        </h2>
        <button type="button" onClick={props.onRemove} className="text-xs font-bold text-zinc-500 hover:text-red-400">
          Quitar
        </button>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {pickBox("Inició con", "start", systemStart, `Lo que había al empezar el ${longDay(from)}`)}
        <div className="rounded-2xl border border-zinc-800 bg-black p-3">
          <p className="text-xs font-bold text-zinc-400">Compras</p>
          <p className="mt-1 text-lg font-black text-emerald-400">+{fmt(moves.purchases, u)}</p>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            value={input.extraPurchases}
            onChange={(e) => onInput({ ...input, extraPurchases: e.target.value })}
            placeholder="+ compras sin capturar"
            className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white"
          />
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-black p-3">
          <p className="text-xs font-bold text-zinc-400">Mermas registradas</p>
          <p className="mt-1 text-lg font-black text-red-400">−{fmt(moves.waste, u)}</p>
          <p className="mt-1 text-[11px] text-zinc-500">No las comió el cliente: no cuentan contra la receta.</p>
        </div>
        {pickBox("Realmente quedó", "end", systemEnd, `Al cerrar el ${longDay(addDays(endExclusive, -1))}. El sistema dice lo que debió quedar según tus recetas.`)}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl bg-black p-3">
          <p className="text-xs text-zinc-400">Según tus recetas se debió gastar</p>
          <p className="text-2xl font-black">{fmt(expected.total, u)}</p>
          <p className="text-[11px] text-zinc-500">Debió quedar {fmt(shouldRemain, u)}</p>
        </div>
        <div className="rounded-2xl bg-black p-3">
          <p className="text-xs text-zinc-400">De verdad se gastó</p>
          <p className="text-2xl font-black">{missing ? "—" : fmt(realUse, u)}</p>
          <p className="text-[11px] text-zinc-500">Inició + compras − mermas − quedó</p>
        </div>
        <div className="rounded-2xl bg-black p-3">
          <p className="text-xs text-zinc-400">Diferencia</p>
          <p className={`text-2xl font-black ${pct === null || missing ? "" : Math.abs(pct) < 3 ? "text-emerald-400" : pct > 0 ? "text-amber-400" : "text-sky-400"}`}>
            {pct === null || missing ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`}
          </p>
          <p className="text-[11px] text-zinc-500">
            {pct === null || missing ? "" : Math.abs(pct) < 3 ? "Tus recetas están bien" : pct > 0 ? "Se usa más de lo que dice la receta" : "Se usa menos de lo que dice la receta"}
          </p>
        </div>
      </div>

      {(soldRows.length > 0 || expected.options.size > 0) && (
        <details className="mt-3 rounded-2xl border border-zinc-800 bg-black p-3 text-sm">
          <summary className="cursor-pointer font-bold text-zinc-300">Vendido con {ing.name.toLowerCase()} ({soldRows.reduce((a, b) => a + b.n, 0)} productos)</summary>
          <div className="mt-2 space-y-1">
            {soldRows.map((r) => (
              <p key={r.name} className="flex justify-between">
                <span>{r.name}</span>
                <span className="font-black">{r.n}</span>
              </p>
            ))}
            {[...expected.options.values()].map((o) => (
              <p key={o.name} className="flex justify-between text-zinc-400">
                <span>{o.name}</span>
                <span className="font-black">{o.times}</span>
              </p>
            ))}
          </div>
        </details>
      )}

      {props.cloudLoading && <p className="mt-3 text-sm font-bold text-sky-400">☁️ Esperando las ventas de la nube para ese rango…</p>}
      {warnings.map((w) => (
        <p key={w} className="mt-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-amber-200">
          ⚠️ {w}
        </p>
      ))}
      {proposal.mode === "ninguno" && proposal.reason && <p className="mt-3 text-sm text-zinc-400">{proposal.reason}</p>}

      {proposal.mode !== "ninguno" && (
        <div className="mt-4">
          {!confirming ? (
            <button
              type="button"
              disabled={!changes || props.cloudLoading}
              onClick={() => setConfirming(true)}
              className="w-full rounded-2xl bg-orange-500 py-3 font-black text-black disabled:opacity-40 sm:w-auto sm:px-6"
            >
              ⚖️ Equivalar productos
            </button>
          ) : (
            <div className="rounded-2xl border border-orange-500/60 bg-black p-4">
              <p className="font-black">
                ¿Deseas equivalar los {changes} productos{proposal.optionChanges.length ? "/opciones" : ""} que llevan {ing.name.toLowerCase()} a estos nuevos valores?
              </p>
              {proposal.mode === "parejo" && <p className="mt-1 text-xs text-zinc-400">Como todavía no tenían cantidad, se reparte parejo entre lo vendido.</p>}
              <div className="mt-3 max-h-72 space-y-1 overflow-y-auto text-sm">
                {proposal.recipeChanges
                  .filter((c) => c.to !== c.from)
                  .map((c) => (
                    <p key={`r${c.productId}`} className="flex justify-between gap-3">
                      <span>
                        {c.name} {c.sold ? <span className="text-xs text-zinc-500">({c.sold} vendidos)</span> : <span className="text-xs text-zinc-500">(no se vendió)</span>}
                      </span>
                      <span className="whitespace-nowrap font-black">
                        {fmt(c.from, u)} → <span className="text-orange-400">{fmt(c.to, u)}</span>
                      </span>
                    </p>
                  ))}
                {proposal.optionChanges
                  .filter((c) => c.to !== c.from)
                  .map((c) => (
                    <p key={`o${c.productId}${c.groupKey}${c.optionKey}`} className="flex justify-between gap-3 text-zinc-300">
                      <span>
                        {c.productName} · {c.name}
                      </span>
                      <span className="whitespace-nowrap font-black">
                        {fmt(c.from, u)} → <span className="text-orange-400">{fmt(c.to, u)}</span>
                      </span>
                    </p>
                  ))}
              </div>
              {stockFix !== 0 && (
                <label className="mt-3 flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={fixStock} onChange={(e) => setFixStock(e.target.checked)} className="mt-1" />
                  <span>
                    Corregir también la existencia de {ing.name.toLowerCase()}: {stockFix > 0 ? "sumarle" : "restarle"} {fmt(Math.abs(stockFix), u)} (la diferencia que contaste). Queda en {fmt(ing.stock + stockFix, u)}.
                  </span>
                </label>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={apply} className="rounded-2xl bg-orange-500 px-6 py-3 font-black text-black">
                  Sí, equivalar
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="rounded-2xl border border-zinc-700 px-6 py-3 font-black">
                  No
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
