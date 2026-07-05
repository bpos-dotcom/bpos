"use client";

import { useEffect, useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import { Ingredient, RecipeItem } from "@/data/inventory";
import { Product } from "@/data/products";
import {
  getAdminIngredients,
  getAdminProducts,
  getAdminRecipes,
  saveAdminRecipes,
} from "@/lib/admin";

export default function RecetasAdminPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [recipes, setRecipes] = useState<RecipeItem[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);

  const [ingredientId, setIngredientId] = useState("");
  const [quantity, setQuantity] = useState("");

  useEffect(() => {
    const savedProducts = getAdminProducts();
    setProducts(savedProducts);
    setIngredients(getAdminIngredients());
    setRecipes(getAdminRecipes());
    setSelectedProductId(savedProducts[0]?.id ?? null);
  }, []);

  const selectedProduct = products.find(
    (product) => product.id === selectedProductId
  );

  const selectedRecipe = recipes.filter(
    (recipe) => recipe.productId === selectedProductId
  );

  function saveRecipes(nextRecipes: RecipeItem[]) {
    setRecipes(nextRecipes);
    saveAdminRecipes(nextRecipes);
  }

  function addRecipeItem() {
    if (!selectedProductId) return;

    if (!ingredientId) {
      alert("Selecciona un ingrediente.");
      return;
    }

    if (Number(quantity) <= 0) {
      alert("Captura una cantidad válida.");
      return;
    }

    const exists = recipes.some(
      (recipe) =>
        recipe.productId === selectedProductId &&
        recipe.ingredientId === Number(ingredientId)
    );

    if (exists) {
      alert("Ese ingrediente ya existe en esta receta.");
      return;
    }

    saveRecipes([
      ...recipes,
      {
        productId: selectedProductId,
        ingredientId: Number(ingredientId),
        quantity: Number(quantity),
      },
    ]);

    setIngredientId("");
    setQuantity("");
  }

  function updateRecipeQuantity(ingredientId: number, value: string) {
    const nextRecipes = recipes.map((recipe) =>
      recipe.productId === selectedProductId &&
      recipe.ingredientId === ingredientId
        ? { ...recipe, quantity: Number(value) }
        : recipe
    );

    saveRecipes(nextRecipes);
  }

  function deleteRecipeItem(ingredientId: number) {
    const nextRecipes = recipes.filter(
      (recipe) =>
        !(
          recipe.productId === selectedProductId &&
          recipe.ingredientId === ingredientId
        )
    );

    saveRecipes(nextRecipes);
  }

  return (
    <RequireRole allow={["Admin"]}>
      <AppShell
        title="Administración de Recetas"
        subtitle="Define qué ingredientes consume cada producto vendido."
      >
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_1fr]">
          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <h2 className="text-xl font-black text-orange-500">Productos</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Selecciona un producto para editar su receta.
            </p>

            <div className="mt-6 space-y-3">
              {products.map((product) => (
                <button
                  key={product.id}
                  onClick={() => setSelectedProductId(product.id)}
                  className={`w-full rounded-2xl border p-4 text-left transition ${
                    selectedProductId === product.id
                      ? "border-orange-500 bg-orange-500/10"
                      : "border-zinc-800 bg-black hover:border-orange-500"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-900 text-2xl">
                      {product.emoji}
                    </div>

                    <div>
                      <p className="font-black">{product.name}</p>
                      <p className="text-sm text-zinc-400">{product.category}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            {!selectedProduct ? (
              <div className="rounded-2xl border border-dashed border-zinc-800 p-10 text-center text-zinc-500">
                Selecciona un producto.
              </div>
            ) : (
              <>
                <div className="border-b border-zinc-800 pb-6">
                  <p className="text-sm font-bold text-orange-500">
                    Receta del producto
                  </p>
                  <h2 className="mt-1 text-3xl font-black">
                    {selectedProduct.name}
                  </h2>
                  <p className="text-zinc-400">
                    {selectedRecipe.length} ingredientes configurados
                  </p>
                </div>

                <div className="mt-6 rounded-3xl border border-zinc-800 bg-black p-5">
                  <h3 className="text-lg font-black text-orange-500">
                    Agregar ingrediente
                  </h3>

                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[1fr_160px_auto]">
                    <select
                      value={ingredientId}
                      onChange={(event) => setIngredientId(event.target.value)}
                      className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-white"
                    >
                      <option value="">Seleccionar ingrediente</option>
                      {ingredients.map((ingredient) => (
                        <option key={ingredient.id} value={ingredient.id}>
                          {ingredient.name} ({ingredient.unit})
                        </option>
                      ))}
                    </select>

                    <input
                      type="number"
                      value={quantity}
                      onChange={(event) => setQuantity(event.target.value)}
                      placeholder="Cantidad"
                      className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-white"
                    />

                    <button
                      onClick={addRecipeItem}
                      className="rounded-2xl bg-orange-500 px-6 py-3 font-black text-black"
                    >
                      Agregar
                    </button>
                  </div>
                </div>

                <div className="mt-6 space-y-3">
                  {selectedRecipe.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
                      Este producto todavía no tiene receta.
                    </div>
                  ) : (
                    selectedRecipe.map((recipe) => {
                      const ingredient = ingredients.find(
                        (item) => item.id === recipe.ingredientId
                      );

                      if (!ingredient) return null;

                      return (
                        <div
                          key={`${recipe.productId}-${recipe.ingredientId}`}
                          className="grid grid-cols-1 gap-3 rounded-2xl border border-zinc-800 bg-black p-4 md:grid-cols-[1fr_160px_auto]"
                        >
                          <div>
                            <p className="font-black">{ingredient.name}</p>
                            <p className="text-sm text-zinc-400">
                              Unidad: {ingredient.unit}
                            </p>
                          </div>

                          <input
                            type="number"
                            value={recipe.quantity}
                            onChange={(event) =>
                              updateRecipeQuantity(
                                ingredient.id,
                                event.target.value
                              )
                            }
                            className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-white"
                          />

                          <button
                            onClick={() => deleteRecipeItem(ingredient.id)}
                            className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 font-black text-red-400"
                          >
                            Eliminar
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </AppShell>
    </RequireRole>
  );
}