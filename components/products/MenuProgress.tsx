"use client";
/**
 * Anillo del avance del menú: % de productos completos (precio, receta y
 * packaging; ver lib/product-completeness.ts). Rojo, amarillo y verde al 100%.
 */
import type { Product } from "@/data/products";
import type { RecipeItem } from "@/data/inventory";
import { menuProgress } from "@/lib/product-completeness";

export function ProgressRing({ percent, size = 88 }: { percent: number; size?: number }) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent));
  const color = p >= 100 ? "#22c55e" : p >= 50 ? "#eab308" : "#ef4444";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${p}% completo`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#27272a" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${(c * p) / 100} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dasharray 0.6s ease" }}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fill={color} fontSize={size * 0.24} fontWeight={900}>
        {p}%
      </text>
    </svg>
  );
}

/** Tarjeta con el anillo y cuántos productos faltan */
export function MenuProgress({ products, recipes, className = "" }: { products: Product[]; recipes: Pick<RecipeItem, "productId" | "quantity">[]; className?: string }) {
  const { done, total, percent } = menuProgress(products, recipes);
  return (
    <div className={`flex items-center gap-4 rounded-3xl border border-zinc-800 bg-zinc-950 p-4 ${className}`}>
      <ProgressRing percent={percent} />
      <div>
        <p className="font-black text-white">{percent >= 100 ? "✅ Menú completo" : "Avance de tu menú"}</p>
        <p className="text-sm text-zinc-400">
          {done} de {total} productos con precio, receta y packaging.
        </p>
        {percent < 100 && <p className="mt-1 text-xs font-bold text-yellow-300">⚠️ {total - done} por completar: tus costos y tu inventario salen exactos cuando todos están completos.</p>}
      </div>
    </div>
  );
}
