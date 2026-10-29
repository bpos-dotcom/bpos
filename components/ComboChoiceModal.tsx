"use client";
/** POS: elegir las opciones de un combo (ej. qué refresco) antes de agregarlo. */
import { useState } from "react";
import type { Product } from "@/data/products";
import { choiceComponents } from "@/lib/compound";

type Props = {
  product: Product;
  products: Product[];
  onConfirm: (chosen: Record<string, number>) => void;
  onClose: () => void;
};

export function ComboChoiceModal({ product, products, onConfirm, onClose }: Props) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const toChoose = choiceComponents(product);
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const ready = toChoose.every((c) => chosen[c.key] !== undefined);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-zinc-800 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-bold text-orange-500">Producto compuesto</p>
        <h2 className="text-2xl font-black">
          {product.emoji} {product.name}
        </h2>

        <div className="mt-5 space-y-5">
          {toChoose.map((component) => (
            <div key={component.key}>
              <p className="mb-2 font-black">
                Elige {component.label || "una opción"}
                {component.quantity > 1 ? ` (${component.quantity})` : ""}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {component.options.map((id) => {
                  const option = byId.get(id);
                  if (!option) return null;
                  const active = chosen[component.key] === id;
                  return (
                    <button
                      key={id}
                      onClick={() => setChosen((prev) => ({ ...prev, [component.key]: id }))}
                      className={`rounded-2xl border p-3 text-left text-sm font-bold ${active ? "border-orange-500 bg-orange-500/15 text-white" : "border-zinc-800 bg-black text-zinc-300"}`}
                    >
                      {option.emoji} {option.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-2xl border border-zinc-800 py-3 font-black">
            Cancelar
          </button>
          <button onClick={() => onConfirm(chosen)} disabled={!ready} className="flex-1 rounded-2xl bg-orange-500 py-3 font-black text-black disabled:opacity-40">
            Agregar ${product.price.toFixed(2)}
          </button>
        </div>
      </div>
    </div>
  );
}
