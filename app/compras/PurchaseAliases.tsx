"use client";

import { useEffect, useState } from "react";
import { Ingredient } from "@/data/inventory";
import {
  addPurchaseAlias,
  getPurchaseAliases,
  PurchaseAlias,
} from "@/lib/purchases";
import { getInventory } from "@/lib/inventory";

export default function PurchaseAliases() {
  const [aliases, setAliases] = useState<PurchaseAlias[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);

  const [ticketName, setTicketName] = useState("");
  const [ingredientId, setIngredientId] = useState("");
  const [quantity, setQuantity] = useState("");

  useEffect(() => {
    setIngredients(getInventory());
    refresh();
  }, []);

  function refresh() {
    setAliases(getPurchaseAliases());
  }

  function saveAlias() {
    if (!ticketName.trim()) {
      alert("Escribe el nombre que aparece en el ticket.");
      return;
    }

    if (!ingredientId) {
      alert("Selecciona un ingrediente.");
      return;
    }

    if (Number(quantity) <= 0) {
      alert("Captura una cantidad válida.");
      return;
    }

    const ingredient = ingredients.find(
      (item) => item.id === Number(ingredientId)
    );

    if (!ingredient) return;

    addPurchaseAlias({
      ticketName,
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      quantity: Number(quantity),
      unit: ingredient.unit,
    });

    setTicketName("");
    setIngredientId("");
    setQuantity("");

    refresh();
  }

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
      <h2 className="text-xl font-black text-orange-500">
        Equivalencias Inteligentes
      </h2>

      <p className="mt-2 text-sm text-zinc-400">
        Configura una sola vez cómo aparece un producto en el ticket y el
        sistema lo reconocerá automáticamente.
      </p>

      <div className="mt-6 space-y-4">

        <input
          value={ticketName}
          onChange={(e) => setTicketName(e.target.value)}
          placeholder="Nombre que aparece en el ticket (Ej. BBQ ABAL)"
          className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
        />

        <select
          value={ingredientId}
          onChange={(e) => setIngredientId(e.target.value)}
          className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
        >
          <option value="">Seleccionar ingrediente</option>

          {ingredients.map((ingredient) => (
            <option key={ingredient.id} value={ingredient.id}>
              {ingredient.name}
            </option>
          ))}
        </select>

        <input
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="Cantidad que agrega al inventario"
          className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
        />

        <button
          onClick={saveAlias}
          className="w-full rounded-2xl bg-orange-500 py-3 font-black text-black transition hover:bg-orange-400"
        >
          Guardar Equivalencia
        </button>

      </div>

      <div className="mt-8 space-y-3">

        {aliases.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-700 p-6 text-center text-zinc-500">
            Todavía no existen equivalencias.
          </div>
        ) : (
          aliases.map((alias) => (
            <div
              key={alias.id}
              className="rounded-2xl border border-zinc-800 bg-black p-4"
            >
              <div className="flex items-center justify-between">

                <div>
                  <p className="font-black text-white">
                    {alias.ticketName}
                  </p>

                  <p className="text-sm text-zinc-400">
                    → {alias.ingredientName}
                  </p>
                </div>

                <div className="text-right">
                  <p className="font-black text-green-400">
                    +{alias.quantity} {alias.unit}
                  </p>
                </div>

              </div>
            </div>
          ))
        )}

      </div>
    </section>
  );
}