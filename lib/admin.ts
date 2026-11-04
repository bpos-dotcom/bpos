import type { Ingredient, RecipeItem } from "@/data/inventory";
import type { Product } from "@/data/products";
import { migrateComponents } from "@/lib/compound";

const PRODUCTS_KEY = "bpos_products";
const INGREDIENTS_KEY = "bpos_inventory";
const RECIPES_KEY = "bpos_recipes";

// Un negocio nuevo empieza vacío: sin productos, insumos ni recetas de ejemplo (antes salían los de Burger Planet)
export function getAdminProducts(): Product[] {
  if (typeof window === "undefined") return [];

  const saved = localStorage.getItem(PRODUCTS_KEY);

  if (!saved) return [];

  const parsed: Product[] = JSON.parse(saved);
  // Combos de la 1.10 (partes) → opciones enlazadas; se guarda una sola vez
  const migrated = migrateComponents(parsed);
  if (migrated) {
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify(migrated));
    return migrated;
  }
  return parsed;
}

export function saveAdminProducts(nextProducts: Product[]) {
  localStorage.setItem(PRODUCTS_KEY, JSON.stringify(nextProducts));
}

export function getAdminIngredients(): Ingredient[] {
  if (typeof window === "undefined") return [];

  const saved = localStorage.getItem(INGREDIENTS_KEY);

  if (!saved) return [];

  return JSON.parse(saved);
}

export function saveAdminIngredients(nextIngredients: Ingredient[]) {
  localStorage.setItem(INGREDIENTS_KEY, JSON.stringify(nextIngredients));
}

export function getAdminRecipes(): RecipeItem[] {
  if (typeof window === "undefined") return [];

  const saved = localStorage.getItem(RECIPES_KEY);

  if (!saved) return [];

  return JSON.parse(saved);
}

export function saveAdminRecipes(nextRecipes: RecipeItem[]) {
  localStorage.setItem(RECIPES_KEY, JSON.stringify(nextRecipes));
}