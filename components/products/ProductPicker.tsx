"use client";
/** Buscador de productos existentes (lupa): para enlazar una opción o copiar opciones. */
import { useMemo, useState } from "react";
import type { Product } from "@/data/products";

type Props = {
  title: string;
  products: Product[];
  onPick: (product: Product) => void;
  onClose: () => void;
  /** Texto extra por producto (ej. "3 grupos de opciones") */
  detail?: (product: Product) => string;
};

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function ProductPicker({ title, products, onPick, onClose, detail }: Props) {
  const [query, setQuery] = useState("");
  const list = useMemo(() => {
    const q = plain(query.trim());
    return products
      .filter((p) => !q || plain(`${p.name} ${p.category}`).includes(q))
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
      .slice(0, 60);
  }, [products, query]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-3xl border border-zinc-800 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-black">🔍 {title}</h3>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre o categoría"
          className="mt-3 w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3"
        />
        <ul className="mt-3 flex-1 space-y-2 overflow-y-auto">
          {list.length === 0 && <li className="p-4 text-center text-sm text-zinc-500">No hay productos con ese nombre.</li>}
          {list.map((p) => (
            <li key={p.id}>
              <button onClick={() => onPick(p)} className="flex w-full items-center gap-3 rounded-2xl border border-zinc-800 bg-black p-3 text-left hover:border-orange-500">
                <span className="text-2xl">{p.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-black">{p.name}</span>
                  <span className="block text-xs text-zinc-400">
                    {p.category} · {p.station} · ${p.price.toFixed(2)}
                    {detail ? ` · ${detail(p)}` : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button onClick={onClose} className="mt-3 rounded-2xl border border-zinc-800 py-3 font-black">
          Cancelar
        </button>
      </div>
    </div>
  );
}
