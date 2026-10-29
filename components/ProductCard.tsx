import { Product } from "@/data/products";

type ProductCardProps = {
  product: Product;
  onAdd: (product: Product) => void;
  /** Fuera de su horario de venta: se ve apagado y dice cuándo se vende */
  offSchedule?: string;
};

export function ProductCard({ product, onAdd, offSchedule }: ProductCardProps) {
  return (
    <button
      onClick={() => onAdd(product)}
      disabled={Boolean(offSchedule)}
      title={offSchedule ? `Fuera de horario: ${offSchedule}` : undefined}
      className={`group rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-black p-4 text-left transition ${offSchedule ? "cursor-not-allowed opacity-40" : "hover:border-orange-500"}`}
    >
      <div className="flex h-24 items-center justify-center rounded-xl bg-zinc-950 text-5xl">
        {product.emoji}
      </div>

      <h3 className="mt-4 font-black">{product.name}</h3>
      <p className="mt-1 text-sm text-zinc-400">{product.category}</p>

      <p className="mt-3 text-2xl font-black text-orange-500">
        ${product.price.toFixed(2)}
      </p>
      {offSchedule && <p className="mt-2 text-xs font-black text-zinc-300">🕒 {offSchedule}</p>}
    </button>
  );
}