"use client";
/**
 * Ficha del insumo (Ingredientes o Packaging) → "💲 Costo": poner el precio
 * a mano sin registrar compra (paquetes × lo que trae cada uno = costo
 * total). No toca la existencia; la siguiente compra real lo reemplaza.
 */
import { useState } from "react";
import type { Ingredient } from "@/data/inventory";
import { getLatestIngredientCost, isManualCost, setManualCost } from "@/lib/purchases";

const input = "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white";
const money = (n: number) => (n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
const date = (iso: string) => new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "2-digit" });

/** Se monta con key = id del insumo: al cambiar de insumo empieza de cero */
export function ManualCost({ ingredient }: { ingredient: Pick<Ingredient, "id" | "name" | "unit"> }) {
  const [last, setLast] = useState(() => getLatestIngredientCost(ingredient.id));
  const [form, setForm] = useState({ packages: "1", perPackage: "", total: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const packages = Number(form.packages) || 0;
  const perPackage = Number(form.perPackage) || 0;
  const total = Number(form.total) || 0;
  const quantity = packages * perPackage;
  const unitCost = quantity > 0 && total > 0 ? total / quantity : 0;

  function save() {
    setMsg(null);
    try {
      const record = setManualCost({ ingredientId: ingredient.id, ingredientName: ingredient.name, unit: ingredient.unit, packages, perPackage, total });
      setLast(record);
      setForm({ packages: "1", perPackage: "", total: "" });
      setMsg({ ok: true, text: `✅ Listo: ${money(record.unitCost)} por ${ingredient.unit}. Food cost ya lo usa.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "No se pudo guardar." });
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-black p-4 xl:col-span-2">
      <p className="text-sm font-black">💲 Costo</p>
      <p className="mt-0.5 text-xs text-zinc-500">
        {last ? (
          <>
            Último costo: <b className="text-white">{money(last.unitCost)} por {ingredient.unit}</b> · {isManualCost(last) ? "puesto a mano" : `compra ${last.supplier}`} el {date(last.purchasedAt)}
          </>
        ) : (
          "Sin costo todavía: en Food cost cuenta como $0."
        )}
      </p>
      <p className="mt-1 text-xs text-zinc-500">Pon el precio sin registrar compra: no cambia la existencia. Cuando registres una compra real, su precio toma el lugar de este.</p>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <label className="text-xs font-bold text-zinc-400">
          Paquetes
          <input type="number" min={0} step="any" value={form.packages} onChange={(e) => setForm({ ...form, packages: e.target.value })} className={`${input} mt-1`} />
        </label>
        <label className="text-xs font-bold text-zinc-400">
          {ingredient.unit} por paquete
          <input type="number" min={0} step="any" value={form.perPackage} onChange={(e) => setForm({ ...form, perPackage: e.target.value })} placeholder="1000" className={`${input} mt-1`} />
        </label>
        <label className="text-xs font-bold text-zinc-400">
          Costo total $
          <input type="number" min={0} step="0.01" value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} placeholder="450" className={`${input} mt-1`} />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={!unitCost} className="rounded-2xl bg-orange-500 px-4 py-2.5 font-black text-black disabled:opacity-40">
          Guardar costo
        </button>
        {unitCost > 0 && (
          <span className="text-sm text-zinc-400">
            {packages} × {perPackage} {ingredient.unit} = {quantity} {ingredient.unit} → <b className="text-white">{money(unitCost)} por {ingredient.unit}</b>
          </span>
        )}
      </div>
      {msg && <p className={`mt-2 text-xs font-bold ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>{msg.text}</p>}
    </div>
  );
}
