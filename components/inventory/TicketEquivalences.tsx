"use client";
/**
 * Ficha del ingrediente → "Cómo viene en el ticket": los nombres con que
 * aparece en los tickets de compra (por proveedor o tienda) y cuánto trae
 * cada uno. La IA de Compras las usa al leer un ticket: "3 x CASABLANCA"
 * con 108 rebanadas por caja = 324 pza al inventario. Son las mismas
 * equivalencias de Compras → Equivalencias; se guardan al agregarlas.
 */
import { useState } from "react";
import { ask } from "@/components/layout/Dialogs";
import type { Ingredient } from "@/data/inventory";
import { compatibleUnits, unitFactor } from "@/lib/units";
import { addPurchaseAlias, deletePurchaseAlias, getPurchaseAliases, getSuppliers, type PurchaseAlias } from "@/lib/purchases";

const input = "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white";

/** Unidades en que se puede escribir lo que trae cada presentación (se convierten a la del ingrediente) */
const unitsFor = (unit: Ingredient["unit"]) => compatibleUnits(unit).map((u) => ({ label: u, factor: unitFactor(u, unit) || 1 }));

/** Equivalencias de este ingrediente y los proveedores conocidos (de Compras y de otras equivalencias) */
function load(ingredientId: number) {
  const all = getPurchaseAliases();
  return {
    aliases: all.filter((a) => Number(a.ingredientId) === Number(ingredientId)),
    suppliers: [...new Set([...getSuppliers().filter((s) => s.active !== false).map((s) => s.name), ...all.map((a) => a.supplier || "")].filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")),
  };
}

/** Se monta con key = id del ingrediente: al cambiar de ingrediente empieza de cero */
export function TicketEquivalences({ ingredient }: { ingredient: Pick<Ingredient, "id" | "name" | "unit"> }) {
  const [data, setData] = useState(() => load(ingredient.id));
  const { aliases, suppliers } = data;
  // Empieza en la unidad del ingrediente (kg si es en kg)
  const [form, setForm] = useState(() => ({ ticketName: "", supplier: "", quantity: "", unit: Math.max(0, unitsFor(ingredient.unit).findIndex((u) => u.label === ingredient.unit)) }));
  const [error, setError] = useState("");
  const refresh = () => setData(load(ingredient.id));

  const units = unitsFor(ingredient.unit);
  const factor = units[form.unit]?.factor || 1;
  const qty = Number(form.quantity) || 0;

  function add() {
    setError("");
    try {
      addPurchaseAlias({
        ticketName: form.ticketName,
        supplier: form.supplier.trim() || undefined,
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        quantity: Math.round(qty * factor * 1000) / 1000,
        unit: ingredient.unit,
      });
      setForm({ ticketName: "", supplier: form.supplier, quantity: "", unit: form.unit });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    }
  }

  async function remove(a: PurchaseAlias) {
    if (!(await ask(`¿Quitar "${a.ticketName}"${a.supplier ? ` de ${a.supplier}` : ""}?`, { ok: "Quitar" }))) return;
    deletePurchaseAlias(a.id);
    refresh();
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-black p-4 xl:col-span-2">
      <p className="text-sm font-black">🧾 Cómo viene en el ticket de compra</p>
      <p className="mt-0.5 text-xs text-zinc-500">
        Escribe el producto como sale en el ticket, de qué proveedor o tienda, y cuánto trae cada uno. Cuando la IA lea un ticket, lo multiplica por las que compraste (ej. 3 x Casablanca de 108 rebanadas = 324 pza).
      </p>

      {aliases.length > 0 && (
        <ul className="mt-3 space-y-2">
          {aliases.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <b className="break-words">{a.ticketName}</b>
                <span className="block text-xs text-zinc-500">{a.supplier || "Cualquier proveedor"}</span>
              </span>
              <span className="font-black text-orange-400">
                {a.quantity} {ingredient.unit} c/u
              </span>
              <button onClick={() => void remove(a)} className="rounded-lg px-2 text-red-300" aria-label={`Quitar ${a.ticketName}`}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <input value={form.ticketName} onChange={(e) => setForm({ ...form, ticketName: e.target.value })} placeholder="Como sale en el ticket (ej. QUESO AMARILLO CASABLANCA)" className={input} />
        <input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} list={`proveedores-${ingredient.id}`} placeholder="Proveedor o tienda (opcional)" className={input} />
        <datalist id={`proveedores-${ingredient.id}`}>
          {suppliers.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-zinc-400">Cada uno trae</span>
        <input type="number" min={0} step="any" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="108" className="w-28 rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white" aria-label="Cantidad que trae cada uno" />
        {units.length > 1 ? (
          <select value={form.unit} onChange={(e) => setForm({ ...form, unit: Number(e.target.value) })} className="rounded-2xl border border-zinc-800 bg-black px-3 py-3 text-white" aria-label="Unidad">
            {units.map((u, i) => (
              <option key={u.label} value={i}>
                {u.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="font-bold text-zinc-300">{ingredient.unit}</span>
        )}
        <button onClick={add} className="rounded-2xl bg-orange-500 px-4 py-3 font-black text-black">
          Agregar
        </button>
        {qty > 0 && (
          <span className="text-xs text-zinc-500">
            Ej. 3 en el ticket = {Math.round(qty * factor * 3 * 100) / 100} {ingredient.unit} al inventario
          </span>
        )}
      </div>
      {error && <p className="mt-2 text-xs font-bold text-red-300">{error}</p>}
    </div>
  );
}
