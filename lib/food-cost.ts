"use client";
/**
 * Tu negocio → Food cost: cuánto cuesta hacer cada producto (receta +
 * empaque, con el precio de la última compra de cada insumo), cuánto deja
 * (utilidad bruta) y, cuando el periodo ya terminó, cuánto deja después de
 * los gastos fijos (utilidad neta).
 *
 * Reparto de los gastos fijos del periodo, según cómo carga cada producto
 * (lo elige el negocio por categoría, o por producto):
 * - "pieza": todas las piezas vendidas cargan lo mismo.
 * - "porcentaje": carga según su precio (bebidas, extras).
 * - "ninguno": no carga gasto fijo (su neta = su bruta); los demás lo absorben.
 * Primero se divide el gasto entre "pieza" y "porcentaje" según lo que vendió
 * cada grupo; dentro de "pieza" entre las piezas, y dentro de "porcentaje"
 * como % del precio. El total siempre suma el gasto fijo del periodo.
 */
import type { Product } from "@/data/products";
import type { Ingredient } from "@/data/inventory";

export type CostMethod = "pieza" | "porcentaje" | "ninguno";
export const COST_METHODS: { value: CostMethod; label: string; hint: string }[] = [
  { value: "pieza", label: "📦 Por pieza", hint: "Cada pieza vendida carga lo mismo" },
  { value: "porcentaje", label: "% Por porcentaje", hint: "Carga según su precio (bebidas, extras)" },
  { value: "ninguno", label: "🚫 No carga", hint: "No carga gasto fijo" },
];

export type FoodCostSettings = { categories: Record<string, CostMethod>; products: Record<string, CostMethod> };
const KEY = "bpos_foodcost_settings";
export const FOODCOST_EVENT = "bpos:foodcost-updated";

export function getFoodCostSettings(): FoodCostSettings {
  if (typeof window === "undefined") return { categories: {}, products: {} };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<FoodCostSettings>;
    return { categories: raw.categories || {}, products: raw.products || {} };
  } catch {
    return { categories: {}, products: {} };
  }
}

export function saveFoodCostSettings(next: FoodCostSettings) {
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(FOODCOST_EVENT));
}

/** Cómo carga el gasto fijo: el del producto, si no el de su categoría; por pieza si no se eligió */
export function methodFor(p: Pick<Product, "id" | "category">, s: FoodCostSettings): CostMethod {
  return s.products[String(p.id)] || s.categories[p.category || ""] || "pieza";
}

type Recipe = { productId: number; ingredientId: number; quantity: number };

export type ProductCost = {
  /** Receta (con lo obligatorio que lleva dentro si es combo) */
  recipe: number;
  packaging: number;
  total: number;
  /** Sin ningún insumo en receta ni empaque */
  noRecipe: boolean;
  /** Insumos sin costo de compra todavía (cuentan $0) */
  missing: string[];
};

/**
 * Costo de 1 pieza tal como está en el POS: su receta + su empaque. En un
 * combo, lo obligatorio que lleva dentro (ej. "Hamburguesa: Mexicana o
 * Clásica") cuenta con el promedio de sus opciones; el empaque de esas partes
 * no cuenta (el combo lleva el suyo).
 */
export function productCost(p: Product, recipes: Recipe[], ingredients: Map<number, Ingredient>, unitCost: (id: number) => number): ProductCost {
  const missing = new Set<string>();
  let lines = 0;
  const cost = (ingredientId: number, quantity: number) => {
    lines += 1;
    const c = unitCost(ingredientId);
    if (!c) missing.add(ingredients.get(ingredientId)?.name || `Insumo ${ingredientId}`);
    return c * (Number(quantity) || 0);
  };
  const recipeOf = (productId: number) => recipes.filter((r) => Number(r.productId) === Number(productId)).reduce((s, r) => s + cost(r.ingredientId, r.quantity), 0);

  let recipe = recipeOf(p.id);
  for (const g of p.modifierGroups || []) {
    const min = Number(g.min) || 0;
    if (min < 1 || !g.options.length) continue;
    const each = g.options.map((o) => (o.productId ? recipeOf(o.productId) : o.ingredientId ? cost(o.ingredientId, Number(o.quantity) || 0) : 0));
    recipe += (each.reduce((s, c) => s + c, 0) / each.length) * min;
  }
  const packaging = (p.packaging || []).reduce((s, l) => s + cost(l.ingredientId, l.quantity), 0);
  return { recipe, packaging, total: recipe + packaging, noRecipe: lines === 0, missing: [...missing] };
}

export type Allocation = { perPiece: number; pctRate: number; pieceUnits: number; pieceSales: number; pctSales: number };

/** Cuánto gasto fijo carga cada pieza ("pieza") y qué % de su precio ("porcentaje") */
export function allocateFixed(fixed: number, sold: { units: number; price: number; method: CostMethod }[]): Allocation {
  let pieceUnits = 0;
  let pieceSales = 0;
  let pctSales = 0;
  for (const s of sold) {
    if (s.method === "pieza") {
      pieceUnits += s.units;
      pieceSales += s.units * s.price;
    } else if (s.method === "porcentaje") pctSales += s.units * s.price;
  }
  const total = pieceSales + pctSales;
  if (!(fixed > 0) || total <= 0) return { perPiece: 0, pctRate: 0, pieceUnits, pieceSales, pctSales };
  // Cada grupo carga según lo que vendió (sin ventas en uno, el otro carga todo)
  const pieceShare = pieceUnits > 0 ? fixed * (pieceSales / total) : 0;
  const pctShare = fixed - pieceShare;
  return {
    perPiece: pieceUnits > 0 ? pieceShare / pieceUnits : 0,
    pctRate: pctSales > 0 ? pctShare / pctSales : 0,
    pieceUnits,
    pieceSales,
    pctSales,
  };
}

/** Gasto fijo que le toca a 1 pieza de un producto */
export function fixedPerUnit(price: number, method: CostMethod, a: Allocation) {
  return method === "pieza" ? a.perPiece : method === "porcentaje" ? price * a.pctRate : 0;
}
