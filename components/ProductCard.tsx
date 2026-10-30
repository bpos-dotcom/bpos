"use client";
import { useState } from "react";
import { Product } from "@/data/products";

type ProductCardProps = {
  product: Product;
  onAdd: (product: Product) => void;
  /** Fuera de su horario de venta: se ve apagado y dice cuándo se vende */
  offSchedule?: string;
  /** Cuántos hay de este producto en el pedido actual */
  inCart?: number;
};

/**
 * Tarjeta del POS. Al tocarla se ilumina en naranja con un "+1" (para saber
 * que sí se marcó) y, mientras esté en el pedido, queda con borde naranja y
 * la cantidad en la esquina.
 */
export function ProductCard({ product, onAdd, offSchedule, inCart = 0 }: ProductCardProps) {
  const [taps, setTaps] = useState(0);
  const selected = inCart > 0;

  return (
    <button
      onClick={() => {
        setTaps((n) => n + 1);
        onAdd(product);
      }}
      disabled={Boolean(offSchedule)}
      title={offSchedule ? `Fuera de horario: ${offSchedule}` : undefined}
      className={`group relative rounded-2xl border bg-gradient-to-b from-zinc-900 to-black p-2.5 text-left transition active:scale-[0.96] sm:p-4 ${
        offSchedule ? "cursor-not-allowed border-zinc-800 opacity-40" : selected ? "border-orange-500 ring-1 ring-orange-500/60" : "border-zinc-800 hover:border-orange-500"
      }`}
    >
      {taps > 0 && (
        <span key={taps} aria-hidden className="bpos-tap pointer-events-none absolute inset-0 rounded-2xl">
          <span className="bpos-tap-plus absolute right-3 top-2 text-xl font-black text-orange-400">+1</span>
        </span>
      )}
      {selected && (
        <span className="absolute -right-1.5 -top-1.5 z-10 flex h-7 min-w-7 items-center justify-center rounded-full bg-orange-500 px-1.5 text-sm font-black text-black shadow-lg">
          {inCart}
        </span>
      )}

      <div className="flex h-14 items-center justify-center rounded-xl bg-zinc-950 text-3xl sm:h-24 sm:text-5xl">
        {product.emoji}
      </div>

      <h3 className="mt-2 text-sm font-black leading-tight sm:mt-4 sm:text-base">{product.name}</h3>
      <p className="mt-1 hidden text-sm text-zinc-400 sm:block">{product.category}</p>

      <p className="mt-1 text-lg font-black text-orange-500 sm:mt-3 sm:text-2xl">
        ${product.price.toFixed(2)}
      </p>
      {offSchedule && <p className="mt-2 text-xs font-black text-zinc-300">🕒 {offSchedule}</p>}
    </button>
  );
}
