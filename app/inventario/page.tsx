"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Ingredient, recipes } from "@/data/inventory";
import { products } from "@/data/products";
import {
  adjustInventory,
  getInventory,
  getKardex,
  InventoryMovement,
} from "@/lib/inventory";

export default function InventarioPage() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [kardex, setKardex] = useState<InventoryMovement[]>([]);

  const [ingredientId, setIngredientId] = useState("");
  const [adjustmentType, setAdjustmentType] = useState<
    "Ajuste positivo" | "Ajuste negativo"
  >("Ajuste positivo");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");

  function refreshInventory() {
    setIngredients(getInventory());
    setKardex(getKardex());
  }

  useEffect(() => {
    refreshInventory();
  }, []);

  function handleAdjustment() {
    try {
      if (!ingredientId) {
        alert("Selecciona un ingrediente.");
        return;
      }

      adjustInventory({
        ingredientId: Number(ingredientId),
        quantity: Number(quantity),
        adjustmentType,
        reason,
      });

      setIngredientId("");
      setQuantity("");
      setReason("");
      setAdjustmentType("Ajuste positivo");
      refreshInventory();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Error al ajustar inventario.");
    }
  }

  const lowStock = ingredients.filter(
    (ingredient) => ingredient.stock <= ingredient.minimum
  );

  return (
    <AppShell
      title="Inventario"
      subtitle="Inventario real, ajustes manuales, recetas y Kardex."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Metric title="Ingredientes" value={ingredients.length.toString()} />
        <Metric title="Alertas" value={lowStock.length.toString()} />
        <Metric title="Recetas" value={products.length.toString()} />
        <Metric title="Movimientos" value={kardex.length.toString()} />
      </div>

      <section className="mt-6 rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <h2 className="text-xl font-black text-orange-500">
          Ajuste manual de inventario
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          Usa esto para compras, conteos físicos, mermas o correcciones.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr_1fr_2fr_auto]">
          <select
            value={ingredientId}
            onChange={(event) => setIngredientId(event.target.value)}
            className="rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
          >
            <option value="">Seleccionar ingrediente</option>
            {ingredients.map((ingredient) => (
              <option key={ingredient.id} value={ingredient.id}>
                {ingredient.name}
              </option>
            ))}
          </select>

          <select
            value={adjustmentType}
            onChange={(event) =>
              setAdjustmentType(
                event.target.value as "Ajuste positivo" | "Ajuste negativo"
              )
            }
            className="rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
          >
            <option>Ajuste positivo</option>
            <option>Ajuste negativo</option>
          </select>

          <input
            type="number"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            placeholder="Cantidad"
            className="rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
          />

          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Motivo obligatorio"
            className="rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
          />

          <button
            onClick={handleAdjustment}
            className="rounded-2xl bg-orange-500 px-6 py-3 font-black text-black"
          >
            Aplicar
          </button>
        </div>
      </section>

      <section className="mt-6 rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <h2 className="text-xl font-black text-orange-500">Inventario real</h2>

        <div className="mt-6 space-y-3">
          {ingredients.map((ingredient) => {
            const isLow = ingredient.stock <= ingredient.minimum;

            return (
              <div
                key={ingredient.id}
                className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-black p-4"
              >
                <div>
                  <p className="font-black">{ingredient.name}</p>
                  <p className="text-sm text-zinc-400">
                    Mínimo: {ingredient.minimum} {ingredient.unit}
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-xl font-black text-orange-500">
                    {ingredient.stock} {ingredient.unit}
                  </p>
                  {isLow && (
                    <p className="text-sm font-bold text-red-400">
                      Stock bajo
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-6 rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <h2 className="text-xl font-black text-orange-500">
          Kardex de inventario
        </h2>

        <div className="mt-6 space-y-3">
          {kardex.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">
              Todavía no hay movimientos de inventario.
            </div>
          ) : (
            [...kardex].reverse().map((movement) => {
              const isPositive = movement.type === "Ajuste positivo";
              const isNegative =
                movement.type === "Ajuste negativo" ||
                movement.type === "Venta POS";

              return (
                <div
                  key={movement.id}
                  className="flex flex-col justify-between gap-3 rounded-2xl border border-zinc-800 bg-black p-4 md:flex-row md:items-center"
                >
                  <div>
                    <p className="font-black">{movement.ingredientName}</p>
                    <p className="text-sm text-zinc-400">
                      {movement.orderId
                        ? `Pedido #${movement.orderId
                            .toString()
                            .padStart(6, "0")} · `
                        : ""}
                      {movement.type}
                    </p>
                    {movement.reason && (
                      <p className="text-sm text-zinc-500">
                        Motivo: {movement.reason}
                      </p>
                    )}
                    <p className="text-xs text-zinc-600">
                      {new Date(movement.createdAt).toLocaleString()}
                    </p>
                  </div>

                  <p
                    className={`text-xl font-black ${
                      isPositive ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {isPositive ? "+" : isNegative ? "-" : ""}
                    {movement.quantity} {movement.unit}
                  </p>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="mt-6 rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <h2 className="text-xl font-black text-orange-500">
          Recetas por producto
        </h2>

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {products.map((product) => {
            const productRecipe = recipes.filter(
              (recipe) => recipe.productId === product.id
            );

            return (
              <div
                key={product.id}
                className="rounded-2xl border border-zinc-800 bg-black p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-3xl">{product.emoji}</p>
                    <h3 className="mt-2 font-black">{product.name}</h3>
                    <p className="text-sm text-zinc-400">{product.category}</p>
                  </div>

                  <p className="text-xl font-black text-orange-500">
                    ${product.price.toFixed(2)}
                  </p>
                </div>

                <div className="mt-5 space-y-2">
                  {productRecipe.map((recipe) => {
                    const ingredient = ingredients.find(
                      (item) => item.id === recipe.ingredientId
                    );

                    if (!ingredient) return null;

                    return (
                      <div
                        key={`${recipe.productId}-${recipe.ingredientId}`}
                        className="flex justify-between rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm"
                      >
                        <span className="text-zinc-300">
                          {ingredient.name}
                        </span>
                        <span className="font-black text-orange-500">
                          {recipe.quantity} {ingredient.unit}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </AppShell>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
      <p className="text-sm text-zinc-400">{title}</p>
      <p className="mt-2 text-3xl font-black text-orange-500">{value}</p>
    </div>
  );
}