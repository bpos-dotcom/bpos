"use client";

import { useEffect, useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import { Ingredient } from "@/data/inventory";
import { getAdminIngredients, saveAdminIngredients } from "@/lib/admin";

type DraftIngredient = Ingredient;

export default function IngredientesAdminPage() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<DraftIngredient | null>(null);

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

    const nextIngredients = ingredients.map((ingredient) =>
      ingredient.id === draft.id ? draft : ingredient
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

            <div className="mt-6 space-y-3">
              {ingredients.map((ingredient) => (
                <button
                  key={ingredient.id}
                  onClick={() => selectIngredient(ingredient)}
                  className={`w-full rounded-2xl border p-4 text-left transition ${
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