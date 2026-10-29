"use client";
/**
 * Receta de un producto (insumos que descuenta del inventario por pieza).
 * En un combo es la receta propia (bolsa, caja...): sus partes ya
 * descuentan la suya.
 */
import type { Ingredient } from "@/data/inventory";

export type RecipeLine = { ingredientId: number; quantity: number };

type Props = {
  lines: RecipeLine[];
  ingredients: Ingredient[];
  compound: boolean;
  onChange: (lines: RecipeLine[]) => void;
};

export function RecipeEditor({ lines, ingredients, compound, onChange }: Props) {
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const available = ingredients.filter((i) => !lines.some((l) => l.ingredientId === i.id)).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section className="mt-6 rounded-3xl border border-zinc-800 bg-black p-6">
      <h3 className="text-xl font-black text-orange-500">📖 {compound ? "Receta propia del combo (opcional)" : "Receta"}</h3>
      <p className="mt-2 text-sm text-zinc-400">
        {compound
          ? "Las partes del combo ya descuentan su propia receta. Aquí pon solo lo extra del combo, como la bolsa o la caja."
          : "Lo que lleva una pieza de este producto. Se descuenta del inventario cada vez que se vende (también dentro de combos)."}
      </p>

      <div className="mt-4 space-y-2">
        {lines.length === 0 && <p className="rounded-2xl border border-dashed border-zinc-800 p-4 text-center text-sm text-zinc-500">Sin insumos todavía.</p>}
        {lines.map((line) => {
          const ingredient = byId.get(line.ingredientId);
          return (
            <div key={line.ingredientId} className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-3">
              <span className="min-w-40 flex-1 font-bold">{ingredient ? ingredient.name : `Insumo borrado (${line.ingredientId})`}</span>
              <input
                type="number"
                min={0}
                step="any"
                value={line.quantity}
                onChange={(e) => onChange(lines.map((l) => (l.ingredientId === line.ingredientId ? { ...l, quantity: Number(e.target.value) || 0 } : l)))}
                className="w-24 rounded-xl border border-zinc-800 bg-black px-3 py-2 text-right"
              />
              <span className="w-10 text-sm text-zinc-400">{ingredient?.unit || ""}</span>
              <button onClick={() => onChange(lines.filter((l) => l.ingredientId !== line.ingredientId))} className="rounded-xl border border-red-500/40 px-3 py-2 text-sm font-black text-red-400">
                Quitar
              </button>
            </div>
          );
        })}
      </div>

      {ingredients.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">Primero da de alta tus insumos en Configuración → Ingredientes.</p>
      ) : (
        <select
          value=""
          onChange={(e) => {
            const id = Number(e.target.value);
            if (id) onChange([...lines, { ingredientId: id, quantity: byId.get(id)?.unit === "pza" ? 1 : 0 }]);
          }}
          className="mt-3 rounded-2xl border border-zinc-700 bg-black px-4 py-2 text-sm"
        >
          <option value="">+ Agregar insumo</option>
          {available.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.unit})
            </option>
          ))}
        </select>
      )}
    </section>
  );
}
