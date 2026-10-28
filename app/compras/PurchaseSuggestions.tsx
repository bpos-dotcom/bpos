"use client";
import { useEffect, useState } from "react";
import { buildSupplierOrderMessage, getPurchaseSuggestions, getSuppliers, PURCHASES_EVENT, whatsappUrl, type PurchaseSuggestion } from "@/lib/purchases";

type Props = { onUse: (items: PurchaseSuggestion[]) => void };

/** Lo que hay que comprar: ingredientes en o debajo de su mínimo */
export default function PurchaseSuggestions({ onUse }: Props) {
  const [items, setItems] = useState<PurchaseSuggestion[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});

  useEffect(() => {
    const load = () => {
      const list = getPurchaseSuggestions();
      setItems(list);
      setSelected(Object.fromEntries(list.map((i) => [i.ingredientId, true])));
    };
    load();
    window.addEventListener(PURCHASES_EVENT, load);
    window.addEventListener("bpos:inventory-updated", load);
    return () => {
      window.removeEventListener(PURCHASES_EVENT, load);
      window.removeEventListener("bpos:inventory-updated", load);
    };
  }, []);

  const chosen = items.filter((i) => selected[i.ingredientId]);
  const estimated = chosen.reduce((s, i) => s + (i.estimatedCost || 0), 0);

  // Agrupar por último proveedor para pedir por WhatsApp
  const bySupplier = chosen.reduce<Record<string, PurchaseSuggestion[]>>((acc, i) => {
    const key = i.lastSupplier || "Sin proveedor";
    (acc[key] ||= []).push(i);
    return acc;
  }, {});

  function orderBySupplier(name: string, list: PurchaseSuggestion[]) {
    const supplier = getSuppliers().find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());
    const phone = supplier?.whatsapp || supplier?.phone || "";
    const message = buildSupplierOrderMessage(
      name === "Sin proveedor" ? "" : name,
      list.map((i) => ({ name: i.ingredientName, quantity: i.suggestedQuantity, unit: i.unit }))
    );
    if (!phone) {
      navigator.clipboard?.writeText(message).catch(() => undefined);
      alert(`${name} no tiene WhatsApp registrado en Proveedores. Copié el pedido para que lo pegues donde quieras:\n\n${message}`);
      return;
    }
    window.open(whatsappUrl(phone, message), "_blank");
  }

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-orange-500">🧠 Sugerencias de compra</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Ingredientes en o debajo de su mínimo. La cantidad sugerida repone hasta el doble del mínimo.
          </p>
        </div>
        {chosen.length > 0 && (
          <div className="rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-right">
            <p className="text-xs text-zinc-500">COSTO ESTIMADO</p>
            <p className="text-xl font-black text-green-400">${estimated.toFixed(2)}</p>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
          ✅ Todo el inventario está arriba de su mínimo.
        </div>
      ) : (
        <>
          <div className="mt-6 space-y-2">
            {items.map((i) => (
              <label key={i.ingredientId} className="flex cursor-pointer flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-black p-4">
                <span className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={Boolean(selected[i.ingredientId])}
                    onChange={(e) => setSelected((s) => ({ ...s, [i.ingredientId]: e.target.checked }))}
                  />
                  <span>
                    <span className="block font-black">{i.ingredientName}</span>
                    <span className="text-xs text-zinc-500">
                      Hay {i.stock} {i.unit} · mínimo {i.minimum} {i.unit}
                      {i.lastSupplier ? ` · último proveedor: ${i.lastSupplier}` : ""}
                    </span>
                  </span>
                </span>
                <span className="text-right">
                  <span className="block font-black text-orange-400">
                    Comprar {i.suggestedQuantity} {i.unit}
                  </span>
                  {i.estimatedCost ? <span className="text-xs text-zinc-500">≈ ${i.estimatedCost.toFixed(2)}</span> : null}
                </span>
              </label>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              disabled={!chosen.length}
              onClick={() => onUse(chosen)}
              className="min-w-[240px] flex-1 rounded-2xl bg-orange-500 px-6 py-3 font-black text-black disabled:opacity-40"
            >
              Registrar como compra →
            </button>
            {Object.entries(bySupplier).map(([name, list]) => (
              <button
                key={name}
                onClick={() => orderBySupplier(name, list)}
                className="rounded-2xl border border-green-500/50 bg-green-500/10 px-5 py-3 font-black text-green-300"
              >
                📲 Pedir a {name} ({list.length})
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
