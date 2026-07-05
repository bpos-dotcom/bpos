"use client";

import { useEffect, useState } from "react";
import { Ingredient } from "@/data/inventory";
import { adjustInventory, getInventory } from "@/lib/inventory";
import { findAliasByTicketName } from "@/lib/purchases";

type Props = {
  onPurchaseCreated?: () => void;
};

const PURCHASES_KEY = "bpos_purchases";

export default function PurchaseForm({ onPurchaseCreated }: Props) {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);

  const [supplier, setSupplier] = useState("");
  const [ticketProductName, setTicketProductName] = useState("");
  const [ingredientId, setIngredientId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [invoice, setInvoice] = useState("");
  const [cost, setCost] = useState("");

  useEffect(() => {
    setIngredients(getInventory());
  }, []);

  function applyAlias() {
    if (!ticketProductName.trim()) {
      alert("Escribe el nombre del producto como aparece en el ticket.");
      return;
    }

    const alias = findAliasByTicketName(ticketProductName);

    if (!alias) {
      alert("No existe equivalencia para ese producto del ticket.");
      return;
    }

    setIngredientId(alias.ingredientId.toString());
    setQuantity(alias.quantity.toString());
  }

  function savePurchase() {
    if (!supplier.trim()) {
      alert("Captura el proveedor.");
      return;
    }

    if (!ingredientId) {
      alert("Selecciona un ingrediente.");
      return;
    }

    if (Number(quantity) <= 0) {
      alert("Cantidad inválida.");
      return;
    }

    const ingredient = ingredients.find(
      (item) => item.id === Number(ingredientId)
    );

    if (!ingredient) return;

    const purchase = {
      id: Date.now(),
      createdAt: new Date().toISOString(),
      supplier,
      ticketProductName,
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      quantity: Number(quantity),
      unit: ingredient.unit,
      invoice,
      cost: Number(cost) || 0,
    };

    const saved = JSON.parse(localStorage.getItem(PURCHASES_KEY) ?? "[]");

    localStorage.setItem(PURCHASES_KEY, JSON.stringify([...saved, purchase]));

    adjustInventory({
      ingredientId: ingredient.id,
      quantity: Number(quantity),
      adjustmentType: "Ajuste positivo",
      reason: `Compra ${supplier}${
        ticketProductName ? ` · Ticket: ${ticketProductName}` : ""
      }`,
    });

    setSupplier("");
    setTicketProductName("");
    setIngredientId("");
    setQuantity("");
    setInvoice("");
    setCost("");

    if (onPurchaseCreated) {
      onPurchaseCreated();
    }

    alert("Compra registrada correctamente.");
  }

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
      <h2 className="text-xl font-black text-orange-500">
        Registrar compra
      </h2>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <input
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
          placeholder="Proveedor"
          className="rounded-2xl border border-zinc-800 bg-black px-4 py-3"
        />

        <input
          value={invoice}
          onChange={(e) => setInvoice(e.target.value)}
          placeholder="Factura / Ticket"
          className="rounded-2xl border border-zinc-800 bg-black px-4 py-3"
        />

        <div className="flex gap-2">
          <input
            value={ticketProductName}
            onChange={(e) => setTicketProductName(e.target.value)}
            placeholder="Producto en ticket. Ej. BBQ ABAL"
            className="flex-1 rounded-2xl border border-zinc-800 bg-black px-4 py-3"
          />

          <button
            onClick={applyAlias}
            className="rounded-2xl border border-orange-500 px-4 py-3 font-black text-orange-500"
          >
            Buscar
          </button>
        </div>

        <select
          value={ingredientId}
          onChange={(e) => setIngredientId(e.target.value)}
          className="rounded-2xl border border-zinc-800 bg-black px-4 py-3"
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
          placeholder="Cantidad"
          className="rounded-2xl border border-zinc-800 bg-black px-4 py-3"
        />

        <input
          type="number"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          placeholder="Costo"
          className="rounded-2xl border border-zinc-800 bg-black px-4 py-3"
        />

        <button
          onClick={savePurchase}
          className="rounded-2xl bg-orange-500 px-6 py-3 font-black text-black"
        >
          Guardar compra
        </button>
      </div>
    </section>
  );
}