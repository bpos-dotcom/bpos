"use client";
/**
 * Editor de producto compuesto (combo): qué productos lo forman.
 * Una parte con varias opciones se elige al cobrar (ej. el refresco).
 */
import type { Product, ProductComponent } from "@/data/products";
import { isCompound } from "@/lib/compound";

type Props = {
  product: Product;
  products: Product[];
  onChange: (components: ProductComponent[] | undefined) => void;
};

const newKey = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function CompoundEditor({ product, products, onChange }: Props) {
  const components = product.components || [];
  const enabled = product.components !== undefined;
  // Solo productos simples pueden ser parte de un combo (sin combos dentro de combos)
  const candidates = products.filter((p) => p.id !== product.id && !isCompound(p)).sort((a, b) => a.name.localeCompare(b.name));
  const byId = new Map(products.map((p) => [p.id, p]));

  const update = (key: string, patch: Partial<ProductComponent>) =>
    onChange(components.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  return (
    <section className="mt-6 rounded-3xl border border-zinc-800 bg-black p-6">
      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked ? (components.length ? components : [{ key: newKey(), label: "", quantity: 1, options: [] }]) : undefined)}
          className="h-6 w-6 accent-orange-500"
        />
        <span className="text-xl font-black text-orange-500">🧩 Es un producto compuesto</span>
      </label>
      <p className="mt-2 text-sm text-zinc-400">
        Para combos: elige los productos que lo forman. Cada uno sale en la comanda de su estación y descuenta su propia receta. El combo conserva su precio.
      </p>

      {enabled && (
        <div className="mt-5 space-y-4">
          {components.map((component, index) => (
            <div key={component.key} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="min-w-40 flex-1">
                  <span className="mb-1 block text-xs font-bold text-zinc-400">Parte {index + 1} (nombre corto)</span>
                  <input
                    value={component.label}
                    onChange={(e) => update(component.key, { label: e.target.value })}
                    placeholder="Ej. Hamburguesa, Papas, Refresco"
                    className="w-full rounded-xl border border-zinc-800 bg-black px-3 py-2"
                  />
                </label>
                <label>
                  <span className="mb-1 block text-xs font-bold text-zinc-400">Cantidad</span>
                  <input
                    type="number"
                    min={1}
                    value={component.quantity}
                    onChange={(e) => update(component.key, { quantity: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
                    className="w-20 rounded-xl border border-zinc-800 bg-black px-3 py-2 text-right"
                  />
                </label>
                <button onClick={() => onChange(components.filter((c) => c.key !== component.key))} className="rounded-xl border border-red-500/40 px-3 py-2 text-sm font-black text-red-400">
                  Quitar parte
                </button>
              </div>

              <p className="mt-3 text-xs font-bold text-zinc-400">
                {component.options.length > 1 ? "Opciones: la cajera elige una al cobrar" : "Producto (agrega más de uno si el cliente puede elegir)"}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {component.options.map((id) => {
                  const p = byId.get(id);
                  return (
                    <span key={id} className="flex items-center gap-2 rounded-full border border-orange-500/50 bg-orange-500/10 px-3 py-1 text-sm">
                      {p ? `${p.emoji} ${p.name} · ${p.station}` : `Producto borrado (${id})`}
                      <button onClick={() => update(component.key, { options: component.options.filter((o) => o !== id) })} className="font-black text-zinc-400" aria-label="Quitar opción">×</button>
                    </span>
                  );
                })}
                <select
                  value=""
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    if (id && !component.options.includes(id)) update(component.key, { options: [...component.options, id] });
                  }}
                  className="rounded-full border border-zinc-700 bg-black px-3 py-1 text-sm"
                >
                  <option value="">+ Agregar producto</option>
                  {candidates
                    .filter((p) => !component.options.includes(p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.category})
                      </option>
                    ))}
                </select>
              </div>
            </div>
          ))}
          <button onClick={() => onChange([...components, { key: newKey(), label: "", quantity: 1, options: [] }])} className="rounded-2xl border border-orange-500 px-4 py-2 font-black text-orange-500">
            + Agregar parte
          </button>
        </div>
      )}
    </section>
  );
}

/** Problemas que impiden guardar un combo (vacío si está bien). */
export function compoundProblems(product: Product) {
  if (product.components === undefined) return "";
  if (!product.components.length) return "El producto compuesto necesita al menos una parte (o quita la casilla).";
  const empty = product.components.findIndex((c) => !c.options.length);
  if (empty >= 0) return `La parte ${empty + 1} no tiene ningún producto.`;
  return "";
}
