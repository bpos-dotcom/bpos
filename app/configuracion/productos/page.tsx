"use client";

import { useEffect, useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import { KitchenStation, Product } from "@/data/products";
import { getAdminProducts, saveAdminProducts } from "@/lib/admin";

type DraftProduct = Product;

const stations: KitchenStation[] = ["Parrilla", "Freidora", "Barra", "Cocina"];

export default function ProductosAdminPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<DraftProduct | null>(null);

  useEffect(() => {
    const savedProducts = getAdminProducts().map((product) => ({
      ...product,
      station: product.station || "Cocina",
    }));

    setProducts(savedProducts);
    setSelectedId(savedProducts[0]?.id ?? null);
    setDraft(savedProducts[0] ?? null);
  }, []);

  function selectProduct(product: Product) {
    setSelectedId(product.id);
    setDraft({ ...product, station: product.station || "Cocina" });
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

    const nextProducts = products.map((product) =>
      product.id === draft.id ? draft : product
    );

    setProducts(nextProducts);
    saveAdminProducts(nextProducts);
    alert("Producto guardado correctamente.");
  }

  function cancelChanges() {
    const original = products.find((product) => product.id === selectedId);
    if (original) setDraft({ ...original, station: original.station || "Cocina" });
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
  }

  return (
    <RequireRole allow={["Admin"]}>
      <AppShell
        title="Administración de Productos"
        subtitle="Edita productos, precios, categorías y estación de preparación."
      >
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_1fr]">
          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
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

            <div className="mt-6 space-y-3">
              {products.map((product) => (
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
                        👨‍🍳 {product.station || "Cocina"}
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

                <section className="mt-6 rounded-3xl border border-zinc-800 bg-black p-6">
                  <h3 className="text-xl font-black text-orange-500">
                    Próximamente
                  </h3>

                  <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <AdminFutureItem text="📖 Editar receta del producto" />
                    <AdminFutureItem text="📷 Subir fotografía real" />
                    <AdminFutureItem text="🛵 Disponibilidad en Didi/Uber" />
                    <AdminFutureItem text="🖨️ Impresión automática por estación" />
                  </div>
                </section>
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

function AdminFutureItem({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-sm font-bold text-zinc-400">
      {text}
    </div>
  );
}