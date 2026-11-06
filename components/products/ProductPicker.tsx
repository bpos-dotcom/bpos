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
  /** Búsqueda con la que abre (ej. el nombre que leyó el Bridge) */
  initialQuery?: string;
  /** Si no hay resultados, botón "Crear" con lo que se buscó */
  onCreate?: (name: string) => void;
};

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function ProductPicker({ title, products, onPick, onClose, detail, initialQuery = "", onCreate }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const list = useMemo(() => {
    const q = plain(query.trim());
    const byName = (a: Product, b: Product) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
    const exact = products.filter((p) => !q || plain(`${p.name} ${p.category}`).includes(q)).sort(byName);
    if (exact.length || !q) return exact.slice(0, 60);
    // Sin coincidencia completa: los parecidos ("Cheese Top Triple" encuentra "CheeseTop Doble")
    const words = q.split(/\s+/).filter((w) => w.length >= 3);
    const score = (p: Product) => {
      const name = plain(p.name);
      const glued = name.replace(/\s+/g, "");
      return words.filter((w) => name.includes(w) || glued.includes(w)).length;
    };
    return products
      .map((p) => ({ p, s: score(p) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || byName(a.p, b.p))
      .slice(0, 30)
      .map((x) => x.p);
  }, [products, query]);
  const q = plain(query.trim());
  const sameName = products.some((p) => plain(p.name.trim()) === q);
  // Los de la lista son solo parecidos (ninguno trae lo buscado completo)
  const similarOnly = Boolean(q) && list.length > 0 && !list.some((p) => plain(`${p.name} ${p.category}`).includes(q));
  const canCreate = Boolean(onCreate && q && !sameName);

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
          {list.length === 0 && !canCreate && <li className="p-4 text-center text-sm text-zinc-500">No hay productos con ese nombre.</li>}
          {similarOnly && <li className="px-1 text-xs font-bold text-zinc-500">No hay uno con ese nombre. Parecidos:</li>}
          {list.map((p) => (
            <li key={p.id}>
              <button onClick={() => onPick(p)} className="flex w-full items-center gap-3 rounded-2xl border border-zinc-800 bg-black p-3 text-left hover:border-orange-500">
                <span className="text-2xl">{p.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-black">{p.name}</span>
                  <span className="block text-xs text-zinc-400">
                    {p.category} · {p.station} · ${p.price.toFixed(2)}
                    {detail?.(p) ? ` · ${detail(p)}` : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {/* No existe con ese nombre: se puede crear (equivalencias del Bridge) */}
          {canCreate && (
            <li>
              <button onClick={() => onCreate!(query.trim())} className="w-full rounded-2xl border border-emerald-500 bg-emerald-500/10 p-4 text-left font-black text-emerald-200 hover:bg-emerald-500/20">
                ➕ Crear producto &quot;{query.trim()}&quot;
                <span className="mt-1 block text-xs font-bold text-zinc-400">Queda en &quot;Por revisar&quot; (no sale en el POS ni en el menú) y se le avisa al dueño para cargarle precio, receta y packaging.</span>
              </button>
            </li>
          )}
        </ul>
        <button onClick={onClose} className="mt-3 rounded-2xl border border-zinc-800 py-3 font-black">
          Cancelar
        </button>
      </div>
    </div>
  );
}
