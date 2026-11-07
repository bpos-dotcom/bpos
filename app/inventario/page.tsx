"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import RequirePermission from "@/components/auth/RequirePermission";
import { getCurrentUser } from "@/lib/auth";
import { requirePermissionOrAdmin } from "@/lib/permissions";
import type { Ingredient, RecipeItem } from "@/data/inventory";
import type { Product } from "@/data/products";
import { getAdminProducts, getAdminRecipes } from "@/lib/admin";
import {
  adjustInventory,
  getInventory,
  getKardex,
  InventoryMovement,
  MERMA_REASONS,
  type AdjustmentType,
} from "@/lib/inventory";
import { getLatestIngredientCost } from "@/lib/purchases";
import { canViewCosts } from "@/lib/auth";
import { addAuditEvent } from "@/lib/audit";
import { downloadXlsx } from "@/lib/xlsx";
import { exportInventory, exportKardex } from "@/lib/exports";

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

      <ListPanel
        title="Inventario real"
        items={ingredients}
        searchText={(ingredient) => `${ingredient.name} ${ingredient.category || ""}`}
        searchPlaceholder="Buscar insumo"
        empty="Todavía no hay insumos."
        actions={(found) =>
          ingredients.length > 0 && (
            <button onClick={() => exportInventory(found, kardex)} className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-black">
              📥 Excel (existencias y kardex)
            </button>
          )
        }
        render={(ingredient) => {
          const isLow = ingredient.stock <= ingredient.minimum;
          return (
            <div key={ingredient.id} className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-black p-4">
              <div>
                <p className="font-black">{ingredient.name}</p>
                <p className="text-sm text-zinc-400">
                  Mínimo: {ingredient.minimum} {ingredient.unit}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xl font-black text-orange-500">
                  {ingredient.stock} {ingredient.unit}
                </p>
                {isLow && <p className="text-sm font-bold text-red-400">Stock bajo</p>}
              </div>
            </div>
          );
        }}
      />

      <ListPanel
        title="Kardex de inventario"
        items={[...kardex].reverse()}
        searchText={(m) => `${m.ingredientName} ${m.type} ${m.reason || ""} ${m.userName || ""} ${m.orderId ?? ""} ${m.externalOrderKey || ""} ${new Date(m.createdAt).toLocaleDateString("es-MX")}`}
        searchPlaceholder="Buscar insumo, pedido, motivo o persona"
        empty="Todavía no hay movimientos de inventario."
        actions={(found) =>
          kardex.length > 0 && (
            <button onClick={() => exportKardex(found)} className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-black">
              📥 Excel
            </button>
          )
        }
        render={(movement) => {
          const isPositive = movement.type === "Ajuste positivo";
          const isNegative = movement.type !== "Ajuste positivo" && movement.finalStock < movement.previousStock;
          return (
            <div key={movement.id} className="flex flex-col justify-between gap-3 rounded-2xl border border-zinc-800 bg-black p-4 md:flex-row md:items-center">
              <div>
                <p className="font-black">{movement.ingredientName}</p>
                <p className="text-sm text-zinc-400">
                  {movement.orderId ? `Pedido #${movement.orderId.toString().padStart(6, "0")} · ` : ""}
                  {movement.type}
                  {movement.userName ? ` · por ${movement.userName}` : ""}
                </p>
                {movement.reason && <p className="text-sm text-zinc-500">Motivo: {movement.reason}</p>}
                <p className="text-xs text-zinc-600">
                  {new Date(movement.createdAt).toLocaleString()}
                  {typeof movement.previousStock === "number" && typeof movement.finalStock === "number" ? ` · ${movement.previousStock} → ${movement.finalStock} ${movement.unit}` : ""}
                </p>
              </div>
              <p className={`text-xl font-black ${isPositive ? "text-green-400" : "text-red-400"}`}>
                {isPositive ? "+" : isNegative ? "-" : ""}
                {movement.quantity} {movement.unit}
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
}: {
  title: string;
  items: T[];
  render: (item: T) => React.ReactNode;
  searchText: (item: T) => string;
  searchPlaceholder: string;
  empty: string;
  actions?: (found: T[]) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = plain(query.trim());
  const found = q ? items.filter((item) => plain(searchText(item)).includes(q)) : items;
  const expanded = open || Boolean(q);
  const shown = expanded ? found : found.slice(0, 2);

  return (
    <section className="mt-6 rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => setOpen(!open)} className="text-left text-xl font-black text-orange-500">
          {title} <span className="text-sm font-bold text-zinc-500">({items.length})</span>
        </button>
        {actions?.(found)}
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

      {items.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">{empty}</div>
      ) : found.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">Nada coincide con &quot;{query}&quot;.</p>
      ) : (
        <div className={`mt-4 space-y-3 ${expanded ? "max-h-[34rem] overflow-y-auto pr-1" : ""}`}>{shown.map(render)}</div>
      )}

      {!q && found.length > 2 && (
        <button type="button" onClick={() => setOpen(!open)} className="mt-3 w-full rounded-2xl border border-zinc-800 py-2.5 text-sm font-black text-zinc-300 hover:border-orange-500">
          {open ? "Ver menos ▴" : `Ver más (${found.length - 2}) ▾`}
        </button>
      )}
      {q && found.length > 0 && <p className="mt-2 text-xs text-zinc-500">{found.length} encontrado{found.length === 1 ? "" : "s"}</p>}
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
