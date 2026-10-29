"use client";

import { useEffect, useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import { KitchenStation, Product } from "@/data/products";
import type { Ingredient, RecipeItem } from "@/data/inventory";
import { getAdminIngredients, getAdminProducts, getAdminRecipes, saveAdminProducts, saveAdminRecipes } from "@/lib/admin";
import { RecipeEditor, type RecipeLine } from "@/components/products/RecipeEditor";
import { ModifierEditor, cleanModifierGroups, modifierEditorProblems } from "@/components/products/ModifierEditor";
import { MultiStationEditor } from "@/components/products/MultiStationEditor";
import { suggestExtraStations } from "@/lib/compound";

type DraftProduct = Product;

const stations: KitchenStation[] = ["Parrilla", "Freidora", "Barra", "Cocina"];

export default function ProductosAdminPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<DraftProduct | null>(null);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [recipes, setRecipes] = useState<RecipeItem[]>([]);
  const [recipeDraft, setRecipeDraft] = useState<RecipeLine[]>([]);
  const [listQuery, setListQuery] = useState("");

  const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const visibleProducts = products.filter((p) => !listQuery.trim() || plain(`${p.name} ${p.category}`).includes(plain(listQuery.trim())));

  const recipeOf = (list: RecipeItem[], productId: number | undefined) =>
    list.filter((r) => Number(r.productId) === Number(productId)).map((r) => ({ ingredientId: Number(r.ingredientId), quantity: Number(r.quantity) }));

  useEffect(() => {
    const savedProducts = getAdminProducts().map((product) => ({
      ...product,
      station: product.station || "Cocina",
    }));

    const savedRecipes = getAdminRecipes();
    setProducts(savedProducts);
    setIngredients(getAdminIngredients());
    setRecipes(savedRecipes);
    setSelectedId(savedProducts[0]?.id ?? null);
    setDraft(savedProducts[0] ?? null);
    setRecipeDraft(recipeOf(savedRecipes, savedProducts[0]?.id));
  }, []);

  function selectProduct(product: Product) {
    setSelectedId(product.id);
    setDraft({ ...product, station: product.station || "Cocina" });
    setRecipeDraft(recipeOf(recipes, product.id));
  }

  function saveDraft() {
    if (!draft) return;

    if (!draft.name.trim()) {
      alert("El producto necesita nombre.");
      return;
    }

    if (draft.price <= 0) {
      alert("El producto necesita un precio válido.");
      return;
    }

    const problem = modifierEditorProblems(draft.modifierGroups);
    if (problem) {
      alert(problem);
      return;
    }

    const saved: Product = { ...draft, name: draft.name.trim(), modifierGroups: cleanModifierGroups(draft.modifierGroups) };
    delete saved.components;
    if (saved.modifierGroups === undefined) delete saved.modifierGroups;
    // Multidestino: sin la estación propia ni repetidas; sin texto se usa "<producto>"
    const extra = (saved.extraStations || []).filter((e, i, all) => e.station !== saved.station && all.findIndex((x) => x.station === e.station) === i).map((e) => ({ station: e.station, text: e.text.trim() || saved.name }));
    if (extra.length) saved.extraStations = extra;
    else delete saved.extraStations;
    // Las opciones solo se muestran en estaciones extra que existen
    saved.modifierGroups?.forEach((g) => {
      const stations = g.stations?.filter((s) => extra.some((e) => e.station === s));
      if (stations?.length) g.stations = stations;
      else delete g.stations;
    });
    if (!saved.noOwnTicket) delete saved.noOwnTicket;
    const nextProducts = products.map((product) =>
      product.id === draft.id ? saved : product
    );

    setProducts(nextProducts);
    saveAdminProducts(nextProducts);

    // Receta: se reemplaza la de este producto (sin renglones en cero)
    const nextRecipes = [
      ...recipes.filter((r) => Number(r.productId) !== Number(draft.id)),
      ...recipeDraft.filter((l) => l.quantity > 0).map((l) => ({ productId: draft.id, ingredientId: l.ingredientId, quantity: l.quantity })),
    ];
    setRecipes(nextRecipes);
    saveAdminRecipes(nextRecipes);
    alert("Producto guardado correctamente.");
  }

  function cancelChanges() {
    const original = products.find((product) => product.id === selectedId);
    if (original) setDraft({ ...original, station: original.station || "Cocina" });
    setRecipeDraft(recipeOf(recipes, selectedId ?? undefined));
  }

  function addProduct() {
    const newProduct: Product = {
      id: Date.now(),
      name: "Nuevo producto",
      category: "Burgers",
      price: 0,
      emoji: "🍔",
      station: "Cocina",
    };

    const nextProducts = [...products, newProduct];
    setProducts(nextProducts);
    saveAdminProducts(nextProducts);
    setSelectedId(newProduct.id);
    setDraft(newProduct);
    setRecipeDraft([]);
  }

  return (
    <RequireRole allow={["Admin"]}>
      <AppShell
        title="Administración de Productos"
        subtitle="Edita productos, precios, categorías y estación de preparación."
      >
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[380px_1fr]">
          {/* La lista tiene su propio deslizador: la página no crece con cada producto */}
          <section className="flex max-h-[70vh] flex-col rounded-3xl border border-zinc-800 bg-zinc-950 p-6 xl:sticky xl:top-36 xl:max-h-[calc(100vh-10rem)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-black text-orange-500">Productos</h2>
                <p className="mt-1 text-sm text-zinc-400">
                  Selecciona un producto para editarlo.
                </p>
              </div>

              <button
                onClick={addProduct}
                className="rounded-2xl bg-orange-500 px-4 py-3 font-black text-black"
              >
                +
              </button>
            </div>

            <input
              value={listQuery}
              onChange={(event) => setListQuery(event.target.value)}
              placeholder="🔍 Buscar producto o categoría"
              className="mt-4 w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-sm"
            />
            <p className="mt-2 text-xs text-zinc-500">{visibleProducts.length} de {products.length} producto(s)</p>

            <div className="bpos-scroll -mr-2 mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-2">
              {visibleProducts.map((product) => (
                <button
                  key={product.id}
                  onClick={() => selectProduct(product)}
                  className={`w-full rounded-2xl border p-4 text-left transition ${
                    selectedId === product.id
                      ? "border-orange-500 bg-orange-500/10"
                      : "border-zinc-800 bg-black hover:border-orange-500"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-900 text-2xl">
                      {product.emoji}
                    </div>

                    <div className="min-w-0">
                      <p className="truncate font-black">{product.name}</p>
                      <p className="text-sm text-zinc-400">
                        {product.category} · ${product.price.toFixed(2)}
                      </p>
                      <p className="mt-1 text-xs font-bold text-orange-400">
                        {product.noOwnTicket ? "🍱 Combo · sale por sus opciones" : `👨‍🍳 ${product.station || "Cocina"}`}
                        {product.modifierGroups?.length ? ` · 🎛️ ${product.modifierGroups.length}` : ""}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            {!draft ? (
              <div className="rounded-2xl border border-dashed border-zinc-800 p-10 text-center text-zinc-500">
                Selecciona un producto.
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-4 border-b border-zinc-800 pb-6 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-black text-5xl">
                      {draft.emoji}
                    </div>

                    <div>
                      <p className="text-sm font-bold text-orange-500">
                        Ficha de producto
                      </p>
                      <h2 className="text-3xl font-black">{draft.name}</h2>
                      <p className="text-zinc-400">
                        {draft.category} · 👨‍🍳 {draft.station || "Cocina"}
                      </p>
                    </div>
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

                  <Field label="Precio">
                    <input
                      type="number"
                      value={draft.price}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          price: Number(event.target.value),
                        })
                      }
                      className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
                    />
                  </Field>

                  <Field label="Categoría">
                    <input
                      value={draft.category}
                      onChange={(event) =>
                        setDraft({ ...draft, category: event.target.value })
                      }
                      className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
                    />
                  </Field>

                  <Field label="Estación de preparación">
                    <select
                      value={draft.station || "Cocina"}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          station: event.target.value as KitchenStation,
                        })
                      }
                      className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
                    >
                      {stations.map((station) => (
                        <option key={station} value={station}>
                          {station}
                        </option>
                      ))}
                    </select>
                    <label className="mt-2 flex cursor-pointer items-start gap-2 text-sm text-zinc-300">
                      <input
                        type="checkbox"
                        checked={Boolean(draft.noOwnTicket)}
                        onChange={(event) => setDraft({ ...draft, noOwnTicket: event.target.checked })}
                        className="mt-0.5 h-5 w-5 accent-orange-500"
                      />
                      <span>
                        Es un combo: no manda comanda propia
                        <span className="block text-xs text-zinc-500">Solo salen sus opciones enlazadas, cada una en la comanda de su estación.</span>
                      </span>
                    </label>
                  </Field>

                  <Field label="Emoji / icono temporal">
                    <input
                      value={draft.emoji}
                      onChange={(event) =>
                        setDraft({ ...draft, emoji: event.target.value })
                      }
                      className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
                    />
                  </Field>
                </div>

                <ModifierEditor
                  groups={draft.modifierGroups || []}
                  ingredients={ingredients}
                  products={products}
                  productId={draft.id}
                  productName={draft.name}
                  extraStations={(draft.extraStations || []).map((e) => e.station)}
                  onChange={(modifierGroups) => setDraft({ ...draft, modifierGroups })}
                />

                <MultiStationEditor
                  mainStation={draft.station || "Cocina"}
                  extraStations={draft.extraStations || []}
                  suggestions={suggestExtraStations(draft, recipeDraft, ingredients)}
                  onChange={(extraStations) => setDraft({ ...draft, extraStations })}
                />

                <RecipeEditor
                  lines={recipeDraft}
                  ingredients={ingredients}
                  compound={Boolean(draft.noOwnTicket)}
                  onChange={setRecipeDraft}
                />

                <p className="mt-4 text-sm text-zinc-500">Los cambios de opciones y receta se guardan con el botón Guardar cambios.</p>
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
