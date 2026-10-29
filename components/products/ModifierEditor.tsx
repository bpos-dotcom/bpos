"use client";
/**
 * Opciones para elegir de un producto (modificadores): grupos como
 * "Aderezo" (obligatorio, 1 incluido) o "Salsas" (4 incluidas, cada extra
 * $15). Las opciones no tienen precio: solo se cobra lo que pase de las
 * incluidas. Cada opción puede descontar un insumo.
 */
import type { Ingredient } from "@/data/inventory";
import type { ModifierGroup, ModifierOption } from "@/data/products";

type Props = {
  groups: ModifierGroup[];
  ingredients: Ingredient[];
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

export function ModifierEditor({ groups, ingredients, onChange }: Props) {
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const updateGroup = (key: string, patch: Partial<ModifierGroup>) => onChange(groups.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  const updateOption = (group: ModifierGroup, key: string, patch: Partial<ModifierOption>) =>
    updateGroup(group.key, { options: group.options.map((o) => (o.key === key ? { ...o, ...patch } : o)) });

  return (
    <section className="mt-6 rounded-3xl border border-zinc-800 bg-black p-6">
      <h3 className="text-xl font-black text-orange-500">🎛️ Opciones para elegir</h3>
      <p className="mt-2 text-sm text-zinc-400">
        Lo que la cajera elige al venderlo: aderezos, salsas, término de la carne... Las incluidas van gratis y solo se cobra cada una de más. Cada opción puede descontar un insumo.
      </p>

      <div className="mt-4 space-y-4">
        {groups.map((group) => (
          <div key={group.key} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
            <div className="flex flex-wrap items-start gap-3">
              <label className="min-w-40 flex-1">
                <span className="mb-1 block text-xs font-bold text-zinc-400">Grupo</span>
                <input
                  value={group.name}
                  onChange={(e) => updateGroup(group.key, { name: e.target.value })}
                  placeholder="Ej. Aderezo, Salsas, Término"
                  className="w-full rounded-xl border border-zinc-800 bg-black px-3 py-2"
                />
              </label>
              <label className="flex items-center gap-2 pt-7 text-sm font-bold">
                <input
                  type="checkbox"
                  checked={group.min > 0}
                  onChange={(e) => updateGroup(group.key, { min: e.target.checked ? 1 : 0 })}
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
            <p className="mt-2 text-xs text-orange-300">{describeGroup(group)}</p>

            <div className="mt-3 space-y-2">
              {group.options.map((option) => {
                const ingredient = option.ingredientId ? byId.get(option.ingredientId) : undefined;
                return (
                  <div key={option.key} className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-black p-2">
                    <input
                      value={option.name}
                      onChange={(e) => updateOption(group, option.key, { name: e.target.value })}
                      placeholder="Opción (ej. BBQ, Ranch aparte, No, gracias)"
                      className="min-w-40 flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1"
                    />
                    <select
                      value={option.ingredientId || ""}
                      onChange={(e) => {
                        const id = Number(e.target.value) || undefined;
                        updateOption(group, option.key, { ingredientId: id, quantity: id ? option.quantity || (byId.get(id)?.unit === "pza" ? 1 : 0) : undefined });
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
    if (!group.options.some((o) => o.name.trim())) return `${label} no tiene opciones.`;
    if (group.max > 0 && group.min > group.max) return `En ${label}, el máximo no puede ser menor que lo obligatorio.`;
    if (group.options.some((o) => o.ingredientId && !(Number(o.quantity) > 0))) return `En ${label}, pon cuánto descuenta cada insumo.`;
  }
  return "";
}

/** Limpia opciones sin nombre antes de guardar. */
export function cleanModifierGroups(groups: ModifierGroup[] | undefined): ModifierGroup[] | undefined {
  const cleaned = (groups || [])
    .map((g) => ({ ...g, name: g.name.trim(), options: g.options.filter((o) => o.name.trim()).map((o) => ({ ...o, name: o.name.trim() })) }))
    .filter((g) => g.options.length);
  return cleaned.length ? cleaned : undefined;
}
