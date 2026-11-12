"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import RequirePermission from "@/components/auth/RequirePermission";
import { getCurrentUser } from "@/lib/auth";
import { requirePermissionOrAdmin } from "@/lib/permissions";
import Link from "next/link";
import { isPackaging, type Ingredient, type RecipeItem } from "@/data/inventory";
import type { Product } from "@/data/products";
import { getAdminProducts, getAdminRecipes } from "@/lib/admin";
import {
  adjustInventory,
  getInventory,
  getKardex,
  isPurchase,
  kardexWithGaps,
  movementLabel,
  InventoryMovement,
  MERMA_REASONS,
  type AdjustmentType,
} from "@/lib/inventory";
import { getLatestIngredientCost } from "@/lib/purchases";
import { canViewCosts } from "@/lib/auth";
import { addAuditEvent } from "@/lib/audit";
import { downloadXlsx } from "@/lib/xlsx";
import { exportInventory, exportKardex } from "@/lib/exports";
import { CheckChips, MoveCard, MovesList, StockBadge, checkItems, isLow, isMovesCheck, isOut, qty, stockMoves, type StockCheck } from "@/components/inventory/StockCheck";

export default function InventarioPage() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  // Los productos y recetas reales del negocio (antes se mostraban los de ejemplo)
  const [products, setProducts] = useState<Product[]>([]);
  const [recipes, setRecipes] = useState<RecipeItem[]>([]);
  const [kardex, setKardex] = useState<InventoryMovement[]>([]);

  const [ingredientId, setIngredientId] = useState("");
  const [adjustmentType, setAdjustmentType] = useState<
    AdjustmentType
  >("Ajuste positivo");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");

  function refreshInventory() {
    setIngredients(getInventory());
    setKardex(getKardex());
  }

  useEffect(() => {
    refreshInventory();
    setProducts(getAdminProducts());
    setRecipes(getAdminRecipes());
  }, []);

  async function handleAdjustment() {
    try {
      const user = getCurrentUser();
      if (!(await requirePermissionOrAdmin(user, "inventory.adjust", "ajustar inventario"))) return;
      if (!ingredientId) {
        alert("Selecciona un ingrediente.");
        return;
      }

      // Merma: se guarda lo que costó lo tirado (último costo de compra del insumo)
      const unitCost = adjustmentType === "Merma" ? getLatestIngredientCost(Number(ingredientId))?.unitCost : undefined;
      const movement = adjustInventory({
        ingredientId: Number(ingredientId),
        quantity: Number(quantity),
        adjustmentType,
        reason,
        ...(unitCost !== undefined ? { cost: unitCost * Number(quantity) } : {}),
      });
      if (adjustmentType === "Merma") {
        addAuditEvent({ category: "Inventario", action: "inventory.waste", description: `${user?.name || "Usuario"} registró merma: ${movement.quantity} ${movement.unit} de ${movement.ingredientName} (${reason})${movement.cost !== undefined ? `, costo $${movement.cost.toFixed(2)}` : ""}`, userId: user?.id ? String(user.id) : undefined, userName: user?.name, entityId: movement.id, metadata: { ingredientId: movement.ingredientId, quantity: movement.quantity, cost: movement.cost, reason } });
      } else {
        // Ajuste a mano: queda quién fue y le llega al dueño
        const sign = adjustmentType === "Ajuste positivo" ? "+" : "-";
        addAuditEvent({ category: "Inventario", action: "inventory.manual_edit", description: `${user?.name || "Usuario"} hizo un ${adjustmentType.toLowerCase()} a ${movement.ingredientName}: ${movement.previousStock} → ${movement.finalStock} ${movement.unit} (${sign}${movement.quantity}). Motivo: ${reason}`, userId: user?.id ? String(user.id) : undefined, userName: user?.name, entityId: movement.id, metadata: { ingredientId: movement.ingredientId, previousStock: movement.previousStock, stock: movement.finalStock, reason, from: "ajuste" } });
      }

      setIngredientId("");
      setQuantity("");
      setReason("");
      setAdjustmentType("Ajuste positivo");
      refreshInventory();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Error al ajustar inventario.");
    }
  }

  // De lo más nuevo a lo más viejo, con los cambios que no dejaron movimiento
  const kardexRows = useMemo(() => kardexWithGaps(kardex).reverse(), [kardex]);

  const lowStock = ingredients.filter(
    (ingredient) => ingredient.stock <= ingredient.minimum
  );

  return (
    <RequirePermission permission="inventory.view"><AppShell
      title="Inventario"
      subtitle="Inventario real, ajustes manuales, recetas y Kardex."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Metric title="Ingredientes" value={ingredients.length.toString()} />
        <Metric title="Alertas" value={lowStock.length.toString()} />
        <Metric title="Recetas" value={products.length.toString()} />
        <Metric title="Movimientos" value={kardex.length.toString()} />
      </div>

      <section className="mt-6 rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <h2 className="text-xl font-black text-orange-500">
          Ajuste manual de inventario
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          Usa esto para compras, conteos físicos, mermas o correcciones.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr_1fr_2fr_auto]">
          <select
            value={ingredientId}
            onChange={(event) => setIngredientId(event.target.value)}
            className="rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
          >
            <option value="">Seleccionar ingrediente</option>
            {ingredients.map((ingredient) => (
              <option key={ingredient.id} value={ingredient.id}>
                {ingredient.name}
              </option>
            ))}
          </select>

          <select
            value={adjustmentType}
            onChange={(event) =>
              setAdjustmentType(
                event.target.value as AdjustmentType
              )
            }
            className="rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
          >
            <option>Ajuste positivo</option>
            <option>Ajuste negativo</option>
            <option value="Merma">Merma (se tiró o se echó a perder)</option>
          </select>

          <input
            type="number"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            placeholder="Cantidad"
            className="rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
          />

          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Motivo obligatorio"
            className="rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
          />

          <button
            onClick={handleAdjustment}
            className="rounded-2xl bg-orange-500 px-6 py-3 font-black text-black"
          >
            Aplicar
          </button>
        </div>
        {adjustmentType === "Merma" && (
          <div className="mt-3 flex flex-wrap gap-2">
            {MERMA_REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)} className={`rounded-xl border px-3 py-2 text-sm font-bold ${reason === r ? "border-orange-500 bg-orange-500/15 text-orange-200" : "border-zinc-800 text-zinc-400"}`}>
                {r}
              </button>
            ))}
          </div>
        )}
      </section>

      <WasteSection kardex={kardex} />

      <InventoryCheckPanel ingredients={ingredients} kardex={kardex} />

      <ListPanel
        title="Kardex de inventario"
        items={kardexRows}
        searchText={(m) => `${m.ingredientName} ${m.type} ${movementLabel(m)} ${m.reason || ""} ${m.userName || ""} ${m.orderId ? `${m.orderId} #${m.orderId.toString().padStart(6, "0")}` : ""} ${m.externalOrderKey || ""} ${new Date(m.createdAt).toLocaleDateString("es-MX")}`}
        searchPlaceholder="Buscar insumo, pedido, motivo o persona"
        empty="Todavía no hay movimientos de inventario."
        filters={KARDEX_FILTERS}
        actions={
          kardex.length > 0 && (
            <button onClick={() => exportKardex(kardex)} className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-black">
              📥 Excel
            </button>
          )
        }
        render={(movement) => {
          const gap = movement.type === "Sin registro";
          const isPositive = movement.finalStock > movement.previousStock;
          const isNegative = movement.finalStock < movement.previousStock;
          return (
            <div className={`flex flex-col justify-between gap-3 rounded-2xl border p-4 md:flex-row md:items-center ${gap ? "border-yellow-500/50 bg-yellow-500/10" : "border-zinc-800 bg-black"}`}>
              <div>
                <p className="font-black">{movement.ingredientName}</p>
                <p className={`text-sm ${gap ? "font-bold text-yellow-300" : "text-zinc-400"}`}>
                  {movement.orderId ? `Pedido #${movement.orderId.toString().padStart(6, "0")} · ` : ""}
                  {gap ? "⚠️ Cambio sin registro (no se sabe quién)" : movementLabel(movement)}
                  {movement.userName ? ` · por ${movement.userName}` : ""}
                </p>
                {movement.reason && <p className="text-sm text-zinc-500">{gap ? movement.reason : `Motivo: ${movement.reason}`}</p>}
                <p className="text-xs text-zinc-600">
                  {movement.gapSince ? `Entre ${new Date(movement.gapSince).toLocaleString()} y ${new Date(movement.createdAt).toLocaleString()}` : gap ? `Antes de ${new Date(movement.createdAt).toLocaleString()}` : new Date(movement.createdAt).toLocaleString()}
                  {typeof movement.previousStock === "number" && typeof movement.finalStock === "number" ? ` · ${qty(movement.previousStock)} → ${qty(movement.finalStock)} ${movement.unit}` : ""}
                </p>
              </div>
              <p className={`text-xl font-black ${isPositive ? "text-green-400" : "text-red-400"}`}>
                {isPositive ? "+" : isNegative ? "-" : ""}
                {qty(Math.abs(movement.quantity))} {movement.unit}
              </p>
            </div>
          );
        }}
      />

      <section className="mt-6 rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <h2 className="text-xl font-black text-orange-500">
          Recetas por producto
        </h2>

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {products.map((product) => {
            const productRecipe = recipes.filter(
              (recipe) => recipe.productId === product.id
            );

            return (
              <div
                key={product.id}
                className="rounded-2xl border border-zinc-800 bg-black p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-3xl">{product.emoji}</p>
                    <h3 className="mt-2 font-black">{product.name}</h3>
                    <p className="text-sm text-zinc-400">{product.category}</p>
                  </div>

                  <p className="text-xl font-black text-orange-500">
                    ${product.price.toFixed(2)}
                  </p>
                </div>

                <div className="mt-5 space-y-2">
                  {productRecipe.map((recipe) => {
                    const ingredient = ingredients.find(
                      (item) => item.id === recipe.ingredientId
                    );

                    if (!ingredient) return null;

                    return (
                      <div
                        key={`${recipe.productId}-${recipe.ingredientId}`}
                        className="flex justify-between rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm"
                      >
                        <span className="text-zinc-300">
                          {ingredient.name}
                        </span>
                        <span className="font-black text-orange-500">
                          {recipe.quantity} {ingredient.unit}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </AppShell></RequirePermission>
  );
}

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Al tocar un insumo abre su ficha (Ingredientes o Packaging) */
const insumoHref = (i: Pick<Ingredient, "id" | "kind">) => `/configuracion/${isPackaging(i) ?"packaging" : "ingredientes"}?insumo=${i.id}`;

/** Categoría para revisar: la del insumo; los empaques sin categoría van en "Packaging" */
const NO_CATEGORY = "Sin categoría";
const checkCategory = (i: Ingredient) => i.category?.trim() || (isPackaging(i) ? "Packaging" : NO_CATEGORY);

/**
 * Inventario real: primero eliges la categoría y luego qué revisar (Todo,
 * Bajo, Agotado, Entradas o Salidas). Contraída muestra 2 insumos.
 */
function InventoryCheckPanel({ ingredients, kardex }: { ingredients: Ingredient[]; kardex: InventoryMovement[] }) {
  const [category, setCategory] = useState("");
  const [check, setCheck] = useState<StockCheck>("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const categories = useMemo(() => {
    const map = new Map<string, number>();
    ingredients.forEach((i) => map.set(checkCategory(i), (map.get(checkCategory(i)) || 0) + 1));
    return [...map.entries()].sort((a, b) => (a[0] === NO_CATEGORY ? 1 : b[0] === NO_CATEGORY ? -1 : a[0].localeCompare(b[0], "es")));
  }, [ingredients]);
  const inCategory = useMemo(() => (category ? ingredients.filter((i) => checkCategory(i) === category) : ingredients), [ingredients, category]);
  const q = plain(query.trim());
  const searched = useMemo(() => (q ? inCategory.filter((i) => plain(`${i.name} ${i.category || ""}`).includes(q)) : inCategory), [inCategory, q]);
  const list = checkItems(searched, check);
  const moves = useMemo(() => stockMoves(kardex, searched, check), [kardex, searched, check]);
  const narrowed = Boolean(category || check || q);
  const expanded = open || narrowed;
  const shown = expanded ? list : list.slice(0, 2);

  return (
    <section className="mt-6 rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => setOpen(!open)} className="text-left text-xl font-black text-orange-500">
          Inventario real <span className="text-sm font-bold text-zinc-500">({ingredients.length})</span>
        </button>
        {ingredients.length > 0 && (
          <button onClick={() => exportInventory(ingredients, kardex)} className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-black">
            📥 Excel (existencias y kardex)
          </button>
        )}
      </div>

      {ingredients.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">Todavía no hay insumos.</div>
      ) : (
        <>
          {categories.length > 1 && (
            <div className="mt-4">
              <p className="mb-1.5 text-xs font-black uppercase tracking-wider text-zinc-500">1. Categoría</p>
              <div className="flex flex-wrap gap-1.5">
                {[["", ingredients.length] as const, ...categories].map(([c, n]) => (
                  <button
                    key={c || "todas"}
                    type="button"
                    onClick={() => setCategory(c)}
                    aria-pressed={category === c}
                    className={`rounded-full border px-3 py-1 text-xs font-black ${category === c ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-800 bg-black text-zinc-300 hover:border-orange-500"}`}
                  >
                    {c || "Todas"} · {n}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mt-3">
            {categories.length > 1 && <p className="mb-1.5 text-xs font-black uppercase tracking-wider text-zinc-500">2. Revisar</p>}
            <CheckChips items={inCategory} check={check} onChange={setCheck} />
          </div>
          <label className="mt-3 flex items-center gap-2 rounded-2xl border border-zinc-800 bg-black px-4 py-2.5">
            <span aria-hidden>🔍</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={category ? `Buscar en ${category}` : "Buscar insumo"} className="w-full bg-transparent text-white outline-none" />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="text-sm font-black text-zinc-500" aria-label="Borrar búsqueda">
                ✕
              </button>
            )}
          </label>

          {isMovesCheck(check) ? (
            <div className="mt-4 max-h-[34rem] overflow-y-auto pr-1">
              <MovesList moves={moves} check={check} scope={category || undefined} renderMove={(m) => <MoveCard move={m} name={ingredients.find((i) => i.id === m.ingredientId)?.name} href={insumoHref({ id: m.ingredientId, kind: ingredients.find((i) => i.id === m.ingredientId)?.kind })} />} />
            </div>
          ) : list.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500">{check === "bajo" ? "Nada bajo de su mínimo" : check === "agotado" ? "Nada agotado" : "Nada coincide"}{category ? ` en ${category}` : ""}{q ? ` con "${query}"` : ""}.</p>
          ) : (
            <div className={`mt-4 space-y-3 ${expanded ? "max-h-[34rem] overflow-y-auto pr-1" : ""}`}>
              {shown.map((ingredient) => {
                const low = isLow(ingredient);
                const out = isOut(ingredient);
                return (
                  <Link key={ingredient.id} href={insumoHref(ingredient)} className={`flex items-center justify-between gap-3 rounded-2xl border bg-black p-4 transition hover:border-orange-500 ${out ? "border-red-500/50" : low ? "border-amber-500/50" : "border-zinc-800"}`}>
                    <div className="min-w-0">
                      <p className="font-black">{ingredient.name}</p>
                      <p className="text-sm text-zinc-400">
                        Mínimo: {qty(ingredient.minimum)} {ingredient.unit}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`text-xl font-black ${out ? "text-red-400" : low ? "text-amber-300" : "text-orange-500"}`}>
                        {qty(ingredient.stock)} {ingredient.unit}
                      </p>
                      <StockBadge item={ingredient} />
                    </div>
                    <span className="shrink-0 text-zinc-600" aria-hidden>
                      ›
                    </span>
                  </Link>
                );
              })}
            </div>
          )}

          {!narrowed && !isMovesCheck(check) && list.length > 2 && (
            <button type="button" onClick={() => setOpen(!open)} className="mt-3 w-full rounded-2xl border border-zinc-800 py-2.5 text-sm font-black text-zinc-300 hover:border-orange-500">
              {open ? "Ver menos ▴" : `Ver más (${list.length - 2}) ▾`}
            </button>
          )}
          {narrowed && !isMovesCheck(check) && list.length > 0 && <p className="mt-2 text-xs text-zinc-500">{list.length} insumo{list.length === 1 ? "" : "s"}</p>}
        </>
      )}
    </section>
  );
}

/** Filtros del kardex: entradas (compras, devoluciones, ajustes +), salidas (ventas y ajustes −), merma */
const KARDEX_FILTERS: { label: string; test: (m: InventoryMovement) => boolean }[] = [
  { label: "⬆️ Entradas", test: (m) => m.type !== "Sin registro" && m.finalStock > m.previousStock },
  { label: "🧾 Compras", test: isPurchase },
  { label: "⬇️ Salidas", test: (m) => m.type !== "Merma" && m.type !== "Sin registro" && m.finalStock < m.previousStock },
  { label: "🗑️ Merma", test: (m) => m.type === "Merma" },
  { label: "⚠️ Sin registro", test: (m) => m.type === "Sin registro" },
];

/**
 * Lista contraída: muestra 2; al tocar "Ver más" se abre con scroll (caben
 * unos 5 o 6). Con la lupa busca en toda la lista y muestra lo encontrado.
 */
function ListPanel<T>({
  title,
  items,
  render,
  searchText,
  searchPlaceholder,
  empty,
  actions,
  filters,
}: {
  title: string;
  items: T[];
  render: (item: T) => React.ReactNode;
  searchText: (item: T) => string;
  searchPlaceholder: string;
  empty: string;
  /** Botones del encabezado (los Excel descargan todo, no solo lo buscado) */
  actions?: React.ReactNode;
  /** Botoncitos para ver solo una parte (ej. Entradas, Existencia baja); se combinan con la lupa */
  filters?: { label: string; test: (item: T) => boolean }[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const q = plain(query.trim());
  const active = filters?.find((f) => f.label === filter);
  // Cada renglón con su lugar en la lista como llave (hay movimientos viejos con el mismo id)
  const found = items.map((item, index) => ({ item, index })).filter(({ item }) => (!active || active.test(item)) && (!q || plain(searchText(item)).includes(q)));
  const narrowed = Boolean(q) || Boolean(active);
  const expanded = open || narrowed;
  const shown = expanded ? found : found.slice(0, 2);

  return (
    <section className="mt-6 rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => setOpen(!open)} className="text-left text-xl font-black text-orange-500">
          {title} <span className="text-sm font-bold text-zinc-500">({items.length})</span>
        </button>
        {actions}
      </div>
      <label className="mt-4 flex items-center gap-2 rounded-2xl border border-zinc-800 bg-black px-4 py-2.5">
        <span aria-hidden>🔍</span>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchPlaceholder} className="w-full bg-transparent text-white outline-none" />
        {query && (
          <button type="button" onClick={() => setQuery("")} className="text-sm font-black text-zinc-500" aria-label="Borrar búsqueda">
            ✕
          </button>
        )}
      </label>
      {filters && items.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {[{ label: "Todo" }, ...filters].map((f) => {
            const on = f.label === "Todo" ? !filter : filter === f.label;
            const count = "test" in f ? items.filter(f.test).length : items.length;
            return (
              <button
                key={f.label}
                type="button"
                onClick={() => setFilter(f.label === "Todo" ? "" : f.label)}
                className={`rounded-xl border px-3 py-1.5 text-sm font-black ${on ? "border-orange-500 bg-orange-500/15 text-orange-200" : "border-zinc-800 text-zinc-400 hover:border-zinc-600"}`}
              >
                {f.label} <span className="font-bold opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {items.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">{empty}</div>
      ) : found.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">{q ? <>Nada coincide con &quot;{query}&quot;{active ? ` en ${active.label}` : ""}.</> : `Nada en ${active?.label || "esta lista"}.`}</p>
      ) : (
        <div className={`mt-4 space-y-3 ${expanded ? "max-h-[34rem] overflow-y-auto pr-1" : ""}`}>{shown.map(({ item, index }) => <Fragment key={index}>{render(item)}</Fragment>)}</div>
      )}

      {!narrowed && found.length > 2 && (
        <button type="button" onClick={() => setOpen(!open)} className="mt-3 w-full rounded-2xl border border-zinc-800 py-2.5 text-sm font-black text-zinc-300 hover:border-orange-500">
          {open ? "Ver menos ▴" : `Ver más (${found.length - 2}) ▾`}
        </button>
      )}
      {narrowed && found.length > 0 && <p className="mt-2 text-xs text-zinc-500">{found.length} encontrado{found.length === 1 ? "" : "s"}</p>}
    </section>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
      <p className="text-sm text-zinc-400">{title}</p>
      <p className="mt-2 text-3xl font-black text-orange-500">{value}</p>
    </div>
  );
}
/** Mermas de los últimos 30 días: qué se tiró, por qué y cuánto costó (el costo solo lo ve el administrador) */
function WasteSection({ kardex }: { kardex: InventoryMovement[] }) {
  const [since] = useState(() => Date.now() - 30 * 24 * 3600_000);
  const showCost = canViewCosts(getCurrentUser().role);
  const waste = kardex.filter((m) => m.type === "Merma" && Date.parse(m.createdAt) >= since).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const total = waste.reduce((s, m) => s + (m.cost || 0), 0);
  const unknown = waste.filter((m) => m.cost === undefined).length;
  const byReason = new Map<string, number>();
  for (const m of waste) byReason.set(m.reason || "Sin motivo", (byReason.get(m.reason || "Sin motivo") || 0) + (m.cost || 0));

  function exportExcel() {
    downloadXlsx(`mermas-${new Date().toISOString().slice(0, 10)}.xlsx`, [
      {
        name: "Mermas",
        rows: [
          ["Fecha", "Insumo", "Cantidad", "Unidad", "Motivo", ...(showCost ? ["Costo"] : [])],
          ...waste.map((m) => [new Date(m.createdAt).toLocaleString("es-MX"), m.ingredientName, m.quantity, m.unit, m.reason || "", ...(showCost ? [m.cost ?? null] : [])]),
        ],
      },
    ]);
  }

  return (
    <section className="mt-6 rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-orange-500">Mermas (últimos 30 días)</h2>
          <p className="mt-1 text-sm text-zinc-400">Lo que se tiró o se echó a perder. Se registra arriba con el tipo &quot;Merma&quot;.</p>
        </div>
        {waste.length > 0 && (
          <button onClick={exportExcel} className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-black">
            📥 Excel
          </button>
        )}
      </div>
      {waste.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">Sin mermas registradas en los últimos 30 días.</p>
      ) : (
        <>
          {showCost && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-black p-4">
                <p className="text-sm text-zinc-400">Costo de lo tirado</p>
                <p className="text-2xl font-black text-red-400">${total.toFixed(2)}</p>
                {unknown > 0 && <p className="mt-1 text-xs text-zinc-500">{unknown} sin costo (el insumo no tiene compras registradas).</p>}
              </div>
              <div className="rounded-2xl bg-black p-4 text-sm">
                <p className="text-zinc-400">Por motivo</p>
                {[...byReason.entries()].sort((a, b) => b[1] - a[1]).map(([r, c]) => (
                  <p key={r} className="flex justify-between">
                    <span>{r}</span>
                    <span className="font-black">${c.toFixed(2)}</span>
                  </p>
                ))}
              </div>
            </div>
          )}
          <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
            {waste.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-black p-3 text-sm">
                <div>
                  <p className="font-black">{m.ingredientName}</p>
                  <p className="text-xs text-zinc-500">{new Date(m.createdAt).toLocaleString("es-MX")} · {m.reason}</p>
                </div>
                <p className="text-right font-black">
                  -{m.quantity} {m.unit}
                  {showCost && m.cost !== undefined && <span className="block text-xs text-red-400">${m.cost.toFixed(2)}</span>}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
