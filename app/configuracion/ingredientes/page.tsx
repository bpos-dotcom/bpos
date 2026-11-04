"use client";

import { useEffect, useMemo, useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import { Ingredient } from "@/data/inventory";
import { getAdminIngredients, saveAdminIngredients } from "@/lib/admin";
import { stationLabel } from "@/lib/kds-config";
import { TicketEquivalences } from "@/components/inventory/TicketEquivalences";

const NO_CATEGORY = "Sin categoría";
const SUGGESTED = ["Carnes", "Lácteos", "Panadería", "Verduras", "Salsas y aderezos", "Bebidas", "Desechables", "Limpieza"];
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type DraftIngredient = Ingredient;

export default function IngredientesAdminPage() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<DraftIngredient | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(""); // "" = todas

  // Categorías con cuántos ingredientes tiene cada una (las que existen, en orden alfabético; "Sin categoría" al final)
  const categories = useMemo(() => {
    const map = new Map<string, number>();
    ingredients.forEach((i) => map.set(i.category?.trim() || NO_CATEGORY, (map.get(i.category?.trim() || NO_CATEGORY) || 0) + 1));
    return [...map.entries()].sort((a, b) => (a[0] === NO_CATEGORY ? 1 : b[0] === NO_CATEGORY ? -1 : a[0].localeCompare(b[0], "es")));
  }, [ingredients]);
  const grouped = useMemo(() => {
    const q = plain(query.trim());
    return categories
      .map(([c]) => [c, ingredients.filter((i) => (i.category?.trim() || NO_CATEGORY) === c && (!q || plain(i.name).includes(q))).sort((a, b) => a.name.localeCompare(b.name, "es"))] as const)
      .filter(([c, list]) => list.length > 0 && (!category || c === category));
  }, [categories, ingredients, query, category]);

  useEffect(() => {
    const savedIngredients = getAdminIngredients();
    setIngredients(savedIngredients);
    setSelectedId(savedIngredients[0]?.id ?? null);
    setDraft(savedIngredients[0] ?? null);
  }, []);

  function selectIngredient(ingredient: Ingredient) {
    setSelectedId(ingredient.id);
    setDraft({ ...ingredient });
  }

  function saveDraft() {
    if (!draft) return;

    if (!draft.name.trim()) {
      alert("El ingrediente necesita nombre.");
      return;
    }

    if (draft.minimum < 0 || draft.stock < 0) {
      alert("Stock y mínimo no pueden ser negativos.");
      return;
    }

    const saved: Ingredient = { ...draft, name: draft.name.trim() };
    if (saved.category?.trim()) saved.category = saved.category.trim().replace(/s+/g, " ").slice(0, 40);
    else delete saved.category;
    const nextIngredients = ingredients.map((ingredient) =>
      ingredient.id === draft.id ? saved : ingredient
    );

    setIngredients(nextIngredients);
    saveAdminIngredients(nextIngredients);
    alert("Ingrediente guardado correctamente.");
  }

  function cancelChanges() {
    const original = ingredients.find(
      (ingredient) => ingredient.id === selectedId
    );
    if (original) setDraft({ ...original });
  }

  function addIngredient() {
    const newIngredient: Ingredient = {
      id: Date.now(),
      name: "Nuevo ingrediente",
      unit: "pza",
      stock: 0,
      minimum: 0,
      ...(category && category !== NO_CATEGORY ? { category } : {}),
    };

    const nextIngredients = [...ingredients, newIngredient];
    setIngredients(nextIngredients);
    saveAdminIngredients(nextIngredients);
    setSelectedId(newIngredient.id);
    setDraft(newIngredient);
  }

  return (
    <RequireRole allow={["Admin"]}>
      <AppShell
        title="Administración de Ingredientes"
        subtitle="Edita ingredientes, unidades, stock y mínimos del inventario."
      >
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_1fr]">
          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-black text-orange-500">
                  Ingredientes
                </h2>
                <p className="mt-1 text-sm text-zinc-400">
                  Selecciona un ingrediente para editarlo.
                </p>
              </div>

              <button
                onClick={addIngredient}
                className="rounded-2xl bg-orange-500 px-4 py-3 font-black text-black"
              >
                +
              </button>
            </div>

            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 Buscar ingrediente" className="mt-4 w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-sm" />
            {categories.length > 1 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {[["", ingredients.length] as const, ...categories].map(([c, n]) => (
                  <button
                    key={c || "todas"}
                    onClick={() => setCategory(c)}
                    className={`rounded-full border px-3 py-1 text-xs font-black ${category === c ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-800 bg-black text-zinc-300 hover:border-orange-500"}`}
                  >
                    {c || "Todas"} · {n}
                  </button>
                ))}
              </div>
            )}

            <div className="bpos-scroll -mr-2 mt-4 max-h-[65vh] space-y-4 overflow-y-auto pr-2">
              {grouped.map(([c, list]) => (
                <div key={c}>
                  {(categories.length > 1 || c !== NO_CATEGORY) && <p className="mb-2 text-xs font-black uppercase tracking-wider text-zinc-500">{c} · {list.length}</p>}
                  <div className="space-y-2">
              {list.map((ingredient) => (
                <button
                  key={ingredient.id}
                  onClick={() => selectIngredient(ingredient)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                    selectedId === ingredient.id
                      ? "border-orange-500 bg-orange-500/10"
                      : "border-zinc-800 bg-black hover:border-orange-500"
                  }`}
                >
                  <p className="font-black">{ingredient.name}</p>
                  <p className="text-sm text-zinc-400">
                    Stock: {ingredient.stock} {ingredient.unit} · Mínimo:{" "}
                    {ingredient.minimum} {ingredient.unit}
                  </p>
                </button>
              ))}
                  </div>
                </div>
              ))}
              {grouped.length === 0 && <p className="text-sm text-zinc-500">{ingredients.length ? "Nada con esa búsqueda." : "Sin ingredientes todavía."}</p>}
            </div>
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            {!draft ? (
              <div className="rounded-2xl border border-dashed border-zinc-800 p-10 text-center text-zinc-500">
                Selecciona un ingrediente.
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-4 border-b border-zinc-800 pb-6 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-bold text-orange-500">
                      Ficha de ingrediente
                    </p>
                    <h2 className="text-3xl font-black">{draft.name}</h2>
                    <p className="text-zinc-400">
                      {draft.stock} {draft.unit} disponibles
                    </p>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={cancelChanges}
                      className="rounded-2xl border border-zinc-800 bg-black px-5 py-3 font-black text-white"
                    >
                      Cancelar
                    </button>

                    <button
                      onClick={saveDraft}
                      className="rounded-2xl bg-orange-500 px-5 py-3 font-black text-black"
                    >
                      Guardar cambios
                    </button>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <Field label="Nombre">
                    <input
                      value={draft.name}
                      onChange={(event) =>
                        setDraft({ ...draft, name: event.target.value })
                      }
                      className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
                    />
                  </Field>

                  <Field label="Unidad">
                    <select
                      value={draft.unit}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          unit: event.target.value as Ingredient["unit"],
                        })
                      }
                      className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
                    >
                      <option value="pza">pza</option>
                      <option value="g">g</option>
                      <option value="ml">ml</option>
                    </select>
                  </Field>

                  <TicketEquivalences key={draft.id} ingredient={draft} />

                  <Field label="Categoría">
                    <input
                      value={draft.category || ""}
                      onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                      list="categorias-ingredientes"
                      maxLength={40}
                      placeholder="Ej. Lácteos, Carnes, Bebidas"
                      className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
                    />
                    <datalist id="categorias-ingredientes">
                      {[...new Set([...categories.map(([c]) => c).filter((c) => c !== NO_CATEGORY), ...SUGGESTED])].map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </Field>

                  <Field label="Stock actual">
                    <input
                      type="number"
                      value={draft.stock}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          stock: Number(event.target.value),
                        })
                      }
                      className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
                    />
                  </Field>

                  <Field label="Stock mínimo">
                    <input
                      type="number"
                      value={draft.minimum}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          minimum: Number(event.target.value),
                        })
                      }
                      className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
                    />
                  </Field>

                  <Field label="Estación que lo prepara (opcional)">
                    <select
                      value={draft.station || ""}
                      onChange={(event) => {
                        const next = { ...draft, station: (event.target.value || undefined) as Ingredient["station"] };
                        if (!next.station) delete next.station;
                        setDraft(next);
                      }}
                      className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
                    >
                      <option value="">Ninguna (se usa tal cual)</option>
                      {(["Parrilla", "Freidora", "Barra", "Cocina"] as const).map((station) => (
                        <option key={station} value={station}>
                          {stationLabel(station)}
                        </option>
                      ))}
                    </select>
                    <span className="mt-2 block text-xs text-zinc-500">
                      Ej. el boneless se fríe en Freidora. Si un producto de otra estación lo lleva en su receta (Boneless Burger en Parrilla), B-POS te sugiere mandarle también una comanda a esta estación.
                    </span>
                  </Field>
                </div>
              </>
            )}
          </section>
        </div>
      </AppShell>
    </RequireRole>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label>
      <span className="mb-2 block text-sm font-bold text-zinc-400">
        {label}
      </span>
      {children}
    </label>
  );
}