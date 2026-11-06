"use client";
/**
 * Receta de un producto (insumos que descuenta del inventario por pieza).
 * En un combo es la receta propia (bolsa, caja...): sus partes ya
 * descuentan la suya. "Copiar ingredientes de" trae la receta de otro
 * producto como copia: cambiarla aquí no toca la del otro.
 */
import { ask } from "@/components/layout/Dialogs";
import type { Ingredient } from "@/data/inventory";

export type RecipeLine = { ingredientId: number; quantity: number };

type Props = {
  lines: RecipeLine[];
  ingredients: Ingredient[];
  compound: boolean;
  onChange: (lines: RecipeLine[]) => void;
  /** Otros productos con receta, para copiar la suya */
  copyFrom?: { id: number; name: string; lines: RecipeLine[] }[];
  /** Recuadro de empaque del producto (Packaging) en vez de la receta */
  packaging?: boolean;
  /** Algo más al final del recuadro (ej. "Este producto no lleva empaque") */
  footer?: React.ReactNode;
};

export function RecipeEditor({ lines, ingredients, compound, onChange, copyFrom = [], packaging = false, footer }: Props) {
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const available = ingredients.filter((i) => !lines.some((l) => l.ingredientId === i.id)).sort((a, b) => a.name.localeCompare(b.name));
  const sources = copyFrom.filter((p) => p.lines.length > 0).sort((a, b) => a.name.localeCompare(b.name, "es"));

  async function copy(id: number) {
    const source = sources.find((p) => p.id === id);
    if (!source) return;
    if (lines.length && !(await ask(`¿Cambiar ${packaging ? `los ${lines.length} empaques` : `los ${lines.length} ingredientes de esta receta`} por los de "${source.name}"?`, { ok: "Copiar" }))) return;
    // Copia nueva: los renglones son otros objetos, el otro producto no cambia
    onChange(source.lines.map((l) => ({ ingredientId: l.ingredientId, quantity: l.quantity })));
  }

  return (
    <section className="mt-6 rounded-3xl border border-zinc-800 bg-black p-6">
      <h3 className="text-xl font-black text-orange-500">{packaging ? "📦 Packaging" : `📖 ${compound ? "Receta propia del combo (opcional)" : "Receta"}`}</h3>
      <p className="mt-2 text-sm text-zinc-400">
        {packaging
          ? "El empaque de este producto (contenedor, bolsa, vaso...). Se descuenta solo cuando se vende este producto: si va dentro de un combo, cuenta el empaque del combo y no este."
          : compound
            ? "Los productos enlazados en sus opciones ya descuentan su propia receta. Aquí pon solo lo extra del combo, como la bolsa o la caja."
            : "Lo que lleva una pieza de este producto. Se descuenta del inventario cada vez que se vende (también dentro de combos)."}
      </p>

      <div className="mt-4 space-y-2">
        {lines.length === 0 && <p className="rounded-2xl border border-dashed border-zinc-800 p-4 text-center text-sm text-zinc-500">{packaging ? "Sin empaque todavía." : "Sin insumos todavía."}</p>}
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

      {/* Siempre visible: sin otro producto con receta/empaque guardado, dice por qué no hay de dónde copiar */}
      <select
        value=""
        disabled={sources.length === 0}
        onChange={(e) => void copy(Number(e.target.value))}
        className="mt-3 mr-2 rounded-2xl border border-zinc-700 bg-black px-4 py-2 text-sm disabled:opacity-60"
        aria-label={packaging ? "Copiar empaque de otro producto" : "Copiar ingredientes de otro producto"}
        title={sources.length === 0 ? `Cuando otro producto tenga ${packaging ? "empaque" : "receta"} guardado, aquí lo copias` : undefined}
      >
        <option value="">
          {sources.length === 0
            ? packaging
              ? "📋 Copiar empaque de… (ningún otro producto tiene todavía)"
              : "📋 Copiar ingredientes de… (ningún otro producto tiene todavía)"
            : packaging
              ? "📋 Copiar empaque de…"
              : "📋 Copiar ingredientes de…"}
        </option>
        {sources.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.lines.length})
          </option>
        ))}
      </select>
      {ingredients.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">{packaging ? "Primero da de alta tus empaques en Tu negocio → Packaging." : "Primero da de alta tus insumos en Tu negocio → Ingredientes."}</p>
      ) : (
        <select
          value=""
          onChange={(e) => {
            const id = Number(e.target.value);
            if (id) onChange([...lines, { ingredientId: id, quantity: byId.get(id)?.unit === "pza" ? 1 : 0 }]);
          }}
          className="mt-3 rounded-2xl border border-zinc-700 bg-black px-4 py-2 text-sm"
        >
          <option value="">{packaging ? "+ Agregar empaque" : "+ Agregar insumo"}</option>
          {available.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.unit})
            </option>
          ))}
        </select>
      )}
      {footer}
    </section>
  );
}
