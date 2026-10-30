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
import { compoundRouting, suggestExtraStations } from "@/lib/compound";
import { stationLabel } from "@/lib/kds-config";
import { SaleScheduleEditor, saveSchedule } from "@/components/products/SaleScheduleEditor";
import { scheduleLabel } from "@/lib/sale-schedule";
import { uploadBusinessImage } from "@/lib/media";

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
  const [uploading, setUploading] = useState(false);

  async function uploadPhoto(file: File | undefined) {
    if (!file || !draft) return;
    setUploading(true);
    try {
      const image = await uploadBusinessImage(file, "productos", 900);
      setDraft((d) => (d ? { ...d, image } : d));
    } catch (e) {
      alert(e instanceof Error ? e.message : "No se pudo subir la foto.");
    } finally {
      setUploading(false);
    }
  }

  const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const [category, setCategory] = useState(""); // "" = todas
  const [pickingCategory, setPickingCategory] = useState(false);
  const categories = [...products.reduce((map, p) => map.set(p.category, (map.get(p.category) || 0) + 1), new Map<string, number>())].sort((a, b) =>
    a[0].localeCompare(b[0], "es")
  );
  const visibleProducts = products.filter(
    (p) => (!category || p.category === category) && (!listQuery.trim() || plain(`${p.name} ${p.category}`).includes(plain(listQuery.trim())))
  );

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
    if (!saved.notSoldAlone) delete saved.notSoldAlone;
    if (!saved.image) delete saved.image;
    if (saved.description?.trim()) saved.description = saved.description.trim().slice(0, 160);
    else delete saved.description;
    const schedule = saveSchedule(saved.saleSchedule);
    if (schedule) saved.saleSchedule = schedule;
    else delete saved.saleSchedule;
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

            <div className="mt-4 flex gap-2">
              <input
                value={listQuery}
                onChange={(event) => setListQuery(event.target.value)}
                placeholder="🔍 Buscar producto"
                className="min-w-0 flex-1 rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-sm"
              />
              <button
                onClick={() => setPickingCategory(true)}
                className={`shrink-0 rounded-2xl border px-4 py-3 text-sm font-black ${category ? "border-orange-500 bg-orange-500/15 text-orange-300" : "border-zinc-800 bg-black text-zinc-300"}`}
              >
                📂 {category ? "Categoría" : "Categorías"}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              {category && (
                <button onClick={() => setCategory("")} className="rounded-full bg-orange-500/15 px-3 py-1 font-black text-orange-300">
                  📂 {category} ✕
                </button>
              )}
              <span>
                {visibleProducts.length} de {products.length} producto(s)
              </span>
            </div>

            {pickingCategory && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setPickingCategory(false)}>
                <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-3xl border border-zinc-800 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
                  <h3 className="text-lg font-black">📂 Categorías</h3>
                  <div className="mt-4 grid flex-1 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                    {[["", products.length] as const, ...categories].map(([name, count]) => (
                      <button
                        key={name || "todas"}
                        onClick={() => {
                          setCategory(name);
                          setPickingCategory(false);
                        }}
                        className={`rounded-2xl border p-4 text-left ${category === name ? "border-orange-500 bg-orange-500/15" : "border-zinc-800 bg-black hover:border-orange-500"}`}
                      >
                        <span className="block font-black">{name || "Todas"}</span>
                        <span className="text-xs text-zinc-400">{count} producto(s)</span>
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setPickingCategory(false)} className="mt-4 rounded-2xl border border-zinc-800 py-3 font-black">
                    Cerrar
                  </button>
                </div>
              </div>
            )}

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
                        {product.notSoldAlone ? " · 🚫 no se vende solo" : ""}
                        {product.saleSchedule ? ` · 🕒 ${scheduleLabel(product.saleSchedule)}` : ""}
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
                    <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-3xl bg-black text-5xl">
                      {draft.image ? (
                        // eslint-disable-next-line @next/next/no-img-element -- foto del producto en la nube
                        <img src={draft.image} alt="" className="h-full w-full object-cover" />
                      ) : (
                        draft.emoji
                      )}
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
                        🧩 Producto compuesto (combo): no manda comanda propia
                        <span className="block text-xs text-zinc-500">
                          Se arma con otros productos: en Opciones para elegir enlázalos con 🔍 (la hamburguesa a elegir, las salchipapas, el refresco). Cada uno sale en la comanda de su estación con sus opciones e instrucciones.
                        </span>
                      </span>
                    </label>
                  </Field>

                  <label className="flex cursor-pointer items-start gap-2 self-end text-sm text-zinc-300 xl:col-span-2">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.notSoldAlone)}
                      onChange={(event) => setDraft({ ...draft, notSoldAlone: event.target.checked })}
                      className="mt-0.5 h-5 w-5 accent-orange-500"
                    />
                    <span>
                      🚫 No se vende por separado
                      <span className="block text-xs text-zinc-500">
                        No aparece en el POS, pero se puede enlazar en combos y opciones, o usar como equivalencia de un modificador de DiDi, Uber o Rappi (ej. &quot;Ranch aparte&quot;): descuenta su receta y sale en su estación. En delivery no suma precio.
                      </span>
                    </span>
                  </label>

                  <div className="xl:col-span-2">
                    <SaleScheduleEditor value={draft.saleSchedule} onChange={(saleSchedule) => setDraft({ ...draft, saleSchedule })} />
                  </div>

                  <Field label="📷 Foto (menú digital)">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="cursor-pointer rounded-2xl border border-orange-500 px-4 py-3 text-sm font-black text-orange-300 hover:bg-orange-500/10">
                        {uploading ? "Subiendo..." : draft.image ? "Cambiar foto" : "Subir foto"}
                        <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={uploading} onChange={(e) => void uploadPhoto(e.target.files?.[0])} />
                      </label>
                      {draft.image && (
                        <button onClick={() => setDraft({ ...draft, image: undefined })} className="rounded-2xl border border-zinc-800 px-4 py-3 text-sm text-zinc-400">
                          Quitar foto
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">Aparece en tu menú digital. Guarda los cambios para que se vea.</p>
                  </Field>

                  <Field label="Descripción (menú digital)">
                    <input
                      value={draft.description || ""}
                      maxLength={160}
                      placeholder="Carne, queso cheddar, tocino y cebolla crispy"
                      onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                      className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
                    />
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

                {compoundRouting(draft, products).length > 1 && (
                  <section className="mt-6 rounded-3xl border border-sky-500/40 bg-sky-500/5 p-6">
                    <h3 className="text-lg font-black text-sky-200">🗺️ Así se reparte en las comandas</h3>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {compoundRouting(draft, products).map((row) => (
                        <div key={row.station} className="rounded-2xl border border-zinc-800 bg-black p-3">
                          <p className="text-sm font-black text-orange-400">👨‍🍳 {stationLabel(row.station)}</p>
                          <ul className="mt-1 space-y-0.5 text-sm text-zinc-300">
                            {row.items.map((text) => (
                              <li key={text}>• {text}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-zinc-500">Al vender, cada estación recibe solo lo suyo, con las opciones elegidas y la instrucción de su producto.</p>
                  </section>
                )}

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
