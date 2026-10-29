"use client";
/**
 * Opciones para elegir de un producto (modificadores): grupos como
 * "Aderezo" (obligatorio, 1 incluido) o "Salsas" (4 incluidas, cada extra
 * $15). Solo se cobra lo que pase de las incluidas.
 *
 * Cada opción es texto ("Bañado", "No, gracias"; puede descontar un insumo)
 * o un producto existente (🔍): descuenta la receta de ese producto y sale
 * en la comanda de su estación. Los grupos se pueden copiar de otro
 * producto: la copia es independiente.
 */
import { useState } from "react";
import type { Ingredient } from "@/data/inventory";
import type { ModifierGroup, ModifierOption, Product } from "@/data/products";
import { copyGroups } from "@/lib/compound";
import { ProductPicker } from "@/components/products/ProductPicker";

type Props = {
  groups: ModifierGroup[];
  ingredients: Ingredient[];
  products: Product[];
  productId: number; // producto que se edita (no se enlaza ni se copia a sí mismo)
  productName: string;
  onChange: (groups: ModifierGroup[]) => void;
};

const newKey = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const newOption = (): ModifierOption => ({ key: newKey(), name: "" });

function NumberField({ label, value, onChange, prefix, hint }: { label: string; value: number; onChange: (n: number) => void; prefix?: string; hint?: string }) {
  return (
    <label>
      <span className="mb-1 block text-xs font-bold text-zinc-400">{label}</span>
      <span className="flex items-center gap-1">
        {prefix && <span className="text-sm text-zinc-400">{prefix}</span>}
        <input
          type="number"
          min={0}
          step={prefix ? "0.5" : "1"}
          value={value}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          className="w-20 rounded-xl border border-zinc-800 bg-black px-3 py-2 text-right"
        />
      </span>
      {hint && <span className="mt-1 block text-[11px] text-zinc-500">{hint}</span>}
    </label>
  );
}

export function ModifierEditor({ groups, ingredients, products, productId, productName, onChange }: Props) {
  const ingredientById = new Map(ingredients.map((i) => [i.id, i]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const [linking, setLinking] = useState<{ group: string; option: string } | null>(null);
  const [copyFrom, setCopyFrom] = useState<Product | null>(null);
  const [pickingCopy, setPickingCopy] = useState(false);
  const [copyKeys, setCopyKeys] = useState<string[]>([]);

  // Cualquier cambio a un grupo copiado lo vuelve propio de este producto
  const touched = (g: ModifierGroup): Partial<ModifierGroup> => (g.copiedFrom && !g.copiedFrom.edited ? { copiedFrom: { ...g.copiedFrom, edited: true } } : {});
  const updateGroup = (key: string, patch: Partial<ModifierGroup>) => onChange(groups.map((g) => (g.key === key ? { ...g, ...touched(g), ...patch } : g)));
  const updateOption = (group: ModifierGroup, key: string, patch: Partial<ModifierOption>) =>
    updateGroup(group.key, { options: group.options.map((o) => (o.key === key ? { ...o, ...patch } : o)) });

  const linkable = products.filter((p) => p.id !== productId);
  const withOptions = products.filter((p) => p.id !== productId && p.modifierGroups?.length);

  return (
    <section className="mt-6 rounded-3xl border border-zinc-800 bg-black p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-black text-orange-500">🎛️ Opciones para elegir</h3>
          <p className="mt-2 max-w-3xl text-sm text-zinc-400">
            Lo que la cajera elige al venderlo: salsas, aderezos, el refresco del combo... Las incluidas van gratis y solo se cobra cada una de más. Una opción puede ser texto o un producto existente (🔍): ese descuenta su receta y sale en la comanda de su estación.
          </p>
        </div>
        <button
          onClick={() => setPickingCopy(true)}
          disabled={!withOptions.length}
          className="rounded-2xl border border-zinc-700 px-4 py-2 text-sm font-black text-zinc-200 disabled:opacity-40"
          title={withOptions.length ? "" : "Ningún otro producto tiene opciones todavía"}
        >
          📋 Copiar opciones de otro producto
        </button>
      </div>

      <div className="mt-4 space-y-4">
        {groups.map((group) => (
          <div key={group.key} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
            {group.copiedFrom && (
              <p className="mb-2 text-xs font-bold text-sky-300">
                {group.copiedFrom.edited
                  ? `📋 Opciones de ${productName || "este producto"} (basado en ${group.copiedFrom.productName})`
                  : `📋 Copiado de ${group.copiedFrom.productName}`}
              </p>
            )}
            <div className="flex flex-wrap items-start gap-3">
              <label className="min-w-40 flex-1">
                <span className="mb-1 block text-xs font-bold text-zinc-400">Grupo</span>
                <input
                  value={group.name}
                  onChange={(e) => updateGroup(group.key, { name: e.target.value })}
                  placeholder="Ej. Salsas, Aderezo, Refresco"
                  className="w-full rounded-xl border border-zinc-800 bg-black px-3 py-2"
                />
              </label>
              <label className="flex items-center gap-2 pt-7 text-sm font-bold">
                <input
                  type="checkbox"
                  checked={group.min > 0}
                  onChange={(e) => updateGroup(group.key, { min: e.target.checked ? Math.max(1, group.included || 1) : 0 })}
                  className="h-5 w-5 accent-orange-500"
                />
                Obligatorio
              </label>
              <NumberField label="Incluidas gratis" value={group.included} onChange={(n) => updateGroup(group.key, { included: Math.round(n) })} />
              <NumberField label="Precio por cada extra" prefix="$" value={group.extraPrice} onChange={(n) => updateGroup(group.key, { extraPrice: n })} hint="0 = no se cobran" />
              <NumberField label="Máximo" value={group.max} onChange={(n) => updateGroup(group.key, { max: Math.round(n) })} hint="0 = sin tope" />
              <button onClick={() => onChange(groups.filter((g) => g.key !== group.key))} className="mt-6 rounded-xl border border-red-500/40 px-3 py-2 text-sm font-black text-red-400">
                Quitar grupo
              </button>
            </div>
            <p className="mt-2 text-xs text-orange-300">
              {describeGroup(group)}
              {group.min > 0 && group.options.length === 1 ? " · se elige sola al vender" : ""}
            </p>

            <div className="mt-3 space-y-2">
              {group.options.map((option) => {
                const linked = option.productId ? productById.get(option.productId) : undefined;
                const ingredient = option.ingredientId ? ingredientById.get(option.ingredientId) : undefined;
                return (
                  <div key={option.key} className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-black p-2">
                    {option.productId ? (
                      <span className="flex min-w-40 flex-1 items-center gap-2 rounded-lg border border-orange-500/50 bg-orange-500/10 px-2 py-1 text-sm font-bold">
                        🔗 {linked ? `${linked.emoji} ${linked.name}` : `Producto borrado (${option.productId})`}
                        <span className="text-xs font-normal text-zinc-400">{linked ? `· ${linked.station} · descuenta su receta` : ""}</span>
                      </span>
                    ) : (
                      <input
                        value={option.name}
                        onChange={(e) => updateOption(group, option.key, { name: e.target.value })}
                        placeholder="Opción de texto (ej. BBQ, Bañado, No, gracias)"
                        className="min-w-40 flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1"
                      />
                    )}

                    {option.productId ? (
                      <button onClick={() => updateOption(group, option.key, { productId: undefined })} className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-300">
                        Quitar enlace
                      </button>
                    ) : (
                      <>
                        <button onClick={() => setLinking({ group: group.key, option: option.key })} className="rounded-lg border border-zinc-700 px-2 py-1 text-xs font-bold text-zinc-200">
                          🔍 Productos existentes
                        </button>
                        <select
                          value={option.ingredientId || ""}
                          onChange={(e) => {
                            const id = Number(e.target.value) || undefined;
                            updateOption(group, option.key, { ingredientId: id, quantity: id ? option.quantity || (ingredientById.get(id)?.unit === "pza" ? 1 : 0) : undefined });
                          }}
                          className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs"
                        >
                          <option value="">Sin insumo</option>
                          {ingredients.map((i) => (
                            <option key={i.id} value={i.id}>
                              Descuenta: {i.name}
                            </option>
                          ))}
                        </select>
                        {option.ingredientId && (
                          <label className="flex items-center gap-1 text-xs text-zinc-400">
                            <input
                              type="number"
                              min={0}
                              step="any"
                              value={option.quantity || 0}
                              onChange={(e) => updateOption(group, option.key, { quantity: Number(e.target.value) || 0 })}
                              className="w-20 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-right text-white"
                            />
                            {ingredient?.unit || ""}
                          </label>
                        )}
                      </>
                    )}
                    <button onClick={() => updateGroup(group.key, { options: group.options.filter((o) => o.key !== option.key) })} className="px-2 font-black text-zinc-500" aria-label="Quitar opción">
                      ×
                    </button>
                  </div>
                );
              })}
              <button onClick={() => updateGroup(group.key, { options: [...group.options, newOption()] })} className="rounded-xl border border-zinc-700 px-3 py-1 text-sm font-bold text-zinc-300">
                + Opción
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={() => onChange([...groups, { key: newKey(), name: "", min: 1, included: 1, extraPrice: 0, max: 0, options: [newOption(), newOption()] }])}
        className="mt-4 rounded-2xl border border-orange-500 px-4 py-2 font-black text-orange-500"
      >
        + Agregar grupo de opciones
      </button>

      {linking && (
        <ProductPicker
          title="Productos existentes"
          products={linkable}
          onClose={() => setLinking(null)}
          onPick={(p) => {
            const group = groups.find((g) => g.key === linking.group);
            if (group) updateOption(group, linking.option, { productId: p.id, name: p.name, ingredientId: undefined, quantity: undefined });
            setLinking(null);
          }}
        />
      )}

      {pickingCopy && (
        <ProductPicker
          title="Copiar opciones de..."
          products={withOptions}
          detail={(p) => `${p.modifierGroups!.length} grupo(s)`}
          onClose={() => setPickingCopy(false)}
          onPick={(p) => {
            setPickingCopy(false);
            setCopyFrom(p);
            setCopyKeys(p.modifierGroups!.map((g) => g.key));
          }}
        />
      )}

      {copyFrom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setCopyFrom(null)}>
          <div className="w-full max-w-lg rounded-3xl border border-zinc-800 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-black">📋 Copiar de {copyFrom.name}</h3>
            <p className="mt-1 text-sm text-zinc-400">Se agregan a este producto como copia: lo que cambies aquí no afecta a {copyFrom.name}.</p>
            <ul className="mt-4 space-y-2">
              {copyFrom.modifierGroups!.map((g) => (
                <li key={g.key}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-zinc-800 bg-black p-3">
                    <input
                      type="checkbox"
                      checked={copyKeys.includes(g.key)}
                      onChange={(e) => setCopyKeys((prev) => (e.target.checked ? [...prev, g.key] : prev.filter((k) => k !== g.key)))}
                      className="h-5 w-5 accent-orange-500"
                    />
                    <span>
                      <span className="block font-black">{g.name}</span>
                      <span className="block text-xs text-zinc-400">
                        {g.options.length} opción(es) · {describeGroup(g)}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex gap-3">
              <button onClick={() => setCopyFrom(null)} className="flex-1 rounded-2xl border border-zinc-800 py-3 font-black">
                Cancelar
              </button>
              <button
                disabled={!copyKeys.length}
                onClick={() => {
                  onChange([...groups, ...copyGroups(copyFrom.modifierGroups!.filter((g) => copyKeys.includes(g.key)), copyFrom.name)]);
                  setCopyFrom(null);
                }}
                className="flex-1 rounded-2xl bg-orange-500 py-3 font-black text-black disabled:opacity-40"
              >
                Copiar {copyKeys.length} grupo(s)
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** "4 incluidas gratis · cada extra $15 · máximo 8" */
export function describeGroup(group: ModifierGroup) {
  const parts = [
    group.min > 0 ? "obligatorio" : "opcional",
    `${group.included} incluida${group.included === 1 ? "" : "s"} gratis`,
    group.extraPrice > 0 ? `cada extra $${group.extraPrice}` : "extras sin costo",
    group.max > 0 ? `máximo ${group.max}` : "sin tope",
  ];
  return parts.join(" · ");
}

/** Problemas que impiden guardar las opciones (vacío si está bien). */
export function modifierEditorProblems(groups: ModifierGroup[] | undefined) {
  for (const [i, group] of (groups || []).entries()) {
    const label = group.name.trim() || `el grupo ${i + 1}`;
    if (!group.name.trim()) return `Ponle nombre al grupo de opciones ${i + 1}.`;
    if (!group.options.some((o) => o.name.trim() || o.productId)) return `${label} no tiene opciones.`;
    if (group.max > 0 && group.min > group.max) return `En ${label}, el máximo no puede ser menor que lo obligatorio.`;
    if (group.options.some((o) => !o.productId && o.ingredientId && !(Number(o.quantity) > 0))) return `En ${label}, pon cuánto descuenta cada insumo.`;
  }
  return "";
}

/** Limpia opciones vacías antes de guardar. */
export function cleanModifierGroups(groups: ModifierGroup[] | undefined): ModifierGroup[] | undefined {
  const cleaned = (groups || [])
    .map((g) => ({ ...g, name: g.name.trim(), options: g.options.filter((o) => o.name.trim() || o.productId).map((o) => ({ ...o, name: o.name.trim() })) }))
    .filter((g) => g.options.length);
  return cleaned.length ? cleaned : undefined;
}
