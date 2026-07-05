import { initialIngredients, Ingredient, recipes, RecipeItem } from "@/data/inventory";
import { products, Product } from "@/data/products";

const PRODUCTS_KEY = "bpos_products";
const INGREDIENTS_KEY = "bpos_inventory";
const RECIPES_KEY = "bpos_recipes";

export function getAdminProducts(): Product[] {
  if (typeof window === "undefined") return products;

  const saved = localStorage.getItem(PRODUCTS_KEY);

  if (!saved) {
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
    return products;
  }

  return JSON.parse(saved);
}

export function saveAdminProducts(nextProducts: Product[]) {
  localStorage.setItem(PRODUCTS_KEY, JSON.stringify(nextProducts));
}

export function getAdminIngredients(): Ingredient[] {
  if (typeof window === "undefined") return initialIngredients;

  const saved = localStorage.getItem(INGREDIENTS_KEY);

  if (!saved) {
    localStorage.setItem(INGREDIENTS_KEY, JSON.stringify(initialIngredients));
    return initialIngredients;
  }

  return JSON.parse(saved);
}

export function saveAdminIngredients(nextIngredients: Ingredient[]) {
  localStorage.setItem(INGREDIENTS_KEY, JSON.stringify(nextIngredients));
}

export function getAdminRecipes(): RecipeItem[] {
  if (typeof window === "undefined") return recipes;

  const saved = localStorage.getItem(RECIPES_KEY);

  if (!saved) {
    localStorage.setItem(RECIPES_KEY, JSON.stringify(recipes));
    return recipes;
  }

  return JSON.parse(saved);
}

export function saveAdminRecipes(nextRecipes: RecipeItem[]) {
  localStorage.setItem(RECIPES_KEY, JSON.stringify(nextRecipes));
}