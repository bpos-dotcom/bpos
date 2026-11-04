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
  /** Cuadrícula (tarjeta con foto) o lista (renglón compacto) */
  layout?: "grid" | "list";
  /** Eligiendo favoritos: estrella prendida o apagada (undefined = no se está eligiendo) */
  favorite?: boolean;
};

/**
 * Tarjeta del POS. Al tocarla se ilumina en naranja con un "+1" (para saber
 * que sí se marcó) y, mientras esté en el pedido, queda con borde naranja y
 * la cantidad en la esquina.
 */
export function ProductCard({ product, onAdd, offSchedule, inCart = 0, layout = "grid", favorite }: ProductCardProps) {
  const [taps, setTaps] = useState(0);
  const selected = inCart > 0;
  const choosing = favorite !== undefined;
  const border = offSchedule
    ? "cursor-not-allowed border-zinc-800 opacity-40"
    : choosing
      ? favorite
        ? "border-yellow-400 ring-1 ring-yellow-400/60"
        : "border-zinc-800 hover:border-yellow-400"
      : selected
        ? "border-orange-500 ring-1 ring-orange-500/60"
        : "border-zinc-800 hover:border-orange-500";

  const star = choosing && (
    <span className={`absolute right-2 top-2 z-10 text-xl ${favorite ? "" : "opacity-30 grayscale"}`} aria-label={favorite ? "En favoritos" : "No está en favoritos"}>
      ⭐
    </span>
  );
  const tap = taps > 0 && !choosing && (
    <span key={taps} aria-hidden className={`bpos-tap pointer-events-none absolute inset-0 ${layout === "list" ? "rounded-xl" : "rounded-2xl"}`}>
      <span className="bpos-tap-plus absolute right-3 top-2 text-xl font-black text-orange-400">+1</span>
    </span>
  );
  const count = selected && !choosing && (
    <span className="absolute -right-1.5 -top-1.5 z-10 flex h-7 min-w-7 items-center justify-center rounded-full bg-orange-500 px-1.5 text-sm font-black text-black shadow-lg">
      {inCart}
    </span>
  );
  // La misma foto que en el menú digital; sin foto, el emoji
  const photo = (cls: string) => (
    <div className={`flex items-center justify-center overflow-hidden rounded-xl bg-zinc-950 ${cls}`}>
      {product.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- fotos del negocio en la nube
        <img src={product.image} alt="" loading="lazy" className="h-full w-full object-contain" />
      ) : (
        product.emoji
      )}
    </div>
  );
  const press = () => {
    setTaps((n) => n + 1);
    onAdd(product);
  };

  if (layout === "list") {
    return (
      <button
        onClick={press}
        disabled={Boolean(offSchedule)}
        title={offSchedule ? `Fuera de horario: ${offSchedule}` : undefined}
        className={`relative flex items-center gap-3 rounded-xl border bg-zinc-950 px-2 py-1.5 text-left transition active:scale-[0.98] ${border}`}
      >
        {tap}
        {count}
        {star}
        {photo("h-10 w-10 shrink-0 text-2xl")}
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm font-black leading-tight">{product.name}</span>
          <span className="block truncate text-xs text-zinc-500">{offSchedule ? `🕒 ${offSchedule}` : product.category}</span>
        </span>
        <span className={`shrink-0 text-sm font-black text-orange-500 sm:text-base ${choosing ? "pr-7" : ""}`}>${product.price.toFixed(2)}</span>
      </button>
    );
  }

  return (
    <button
      onClick={press}
      disabled={Boolean(offSchedule)}
      title={offSchedule ? `Fuera de horario: ${offSchedule}` : undefined}
      className={`group relative rounded-2xl border bg-gradient-to-b from-zinc-900 to-black p-2.5 text-left transition active:scale-[0.96] sm:p-4 ${border}`}
    >
      {tap}
      {count}
      {star}

      {photo("h-14 text-3xl sm:h-24 sm:text-5xl")}

      <h3 className="mt-2 text-sm font-black leading-tight sm:mt-4 sm:text-base">{product.name}</h3>
      <p className="mt-1 hidden text-sm text-zinc-400 sm:block">{product.category}</p>

      <p className="mt-1 text-lg font-black text-orange-500 sm:mt-3 sm:text-2xl">
        ${product.price.toFixed(2)}
      </p>
      {offSchedule && <p className="mt-2 text-xs font-black text-zinc-300">🕒 {offSchedule}</p>}
    </button>
  );
}
