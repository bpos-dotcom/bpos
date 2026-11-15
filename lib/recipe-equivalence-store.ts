"use client";
/**
 * Guardar lo que decide el Equivalador de insumos: recetas y opciones con la
 * cantidad nueva, corrección de la existencia (si se contó) y un registro
 * con los valores de antes para poder regresarlos.
 */
import type { RecipeItem } from "@/data/inventory";
import { getAdminProducts, getAdminRecipes, saveAdminProducts, saveAdminRecipes } from "@/lib/admin";
import { adjustInventory } from "@/lib/inventory";
import { addAuditEvent } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { addRecipeLine, applyOptionChanges, applyRecipeChanges, linkOption, type OptionChange, type RecipeChange, type UnlinkedOption, type UnlinkedProduct } from "@/lib/recipe-equivalence";

const LOG_KEY = "bpos_recipe_equivalence_log";
const PICKS_KEY = "bpos_equivalence_ingredients";

export type EquivalenceLogEntry = {
  id: string;
  createdAt: string;
  userName?: string;
  ingredientId: number;
  ingredientName: string;
  unit: string;
  from: string;
  to: string;
  realUse: number;
  expectedUse: number;
  factor: number;
  recipeChanges: RecipeChange[];
  optionChanges: OptionChange[];
  stockFix?: number;
  undoneAt?: string;
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const getEquivalenceLog = () => read<EquivalenceLogEntry[]>(LOG_KEY, []);
export const getEquivalencePicks = () => read<number[]>(PICKS_KEY, []).map(Number);
export function saveEquivalencePicks(ids: number[]) {
  localStorage.setItem(PICKS_KEY, JSON.stringify([...new Set(ids.map(Number))]));
}

function notify() {
  window.dispatchEvent(new Event("bpos:inventory-updated"));
  window.dispatchEvent(new Event("storage"));
}

export function applyEquivalence(entry: Omit<EquivalenceLogEntry, "id" | "createdAt" | "userName">) {
  const user = getCurrentUser();
  saveAdminRecipes(applyRecipeChanges(getAdminRecipes(), entry.ingredientId, entry.recipeChanges));
  if (entry.optionChanges.length) saveAdminProducts(applyOptionChanges(getAdminProducts(), entry.optionChanges));
  if (entry.stockFix && Math.abs(entry.stockFix) > 1e-9) {
    adjustInventory({
      ingredientId: entry.ingredientId,
      quantity: Math.abs(entry.stockFix),
      adjustmentType: entry.stockFix > 0 ? "Ajuste positivo" : "Ajuste negativo",
      reason: `Conteo del equivalador de insumos (${entry.from} a ${entry.to})`,
    });
  }
  const saved: EquivalenceLogEntry = { ...entry, id: `eq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date().toISOString(), ...(user?.name ? { userName: user.name } : {}) };
  localStorage.setItem(LOG_KEY, JSON.stringify([saved, ...getEquivalenceLog()].slice(0, 200)));
  const pct = entry.expectedUse > 0 ? Math.round((entry.realUse / entry.expectedUse - 1) * 100) : null;
  addAuditEvent({
    category: "Inventario",
    action: "recipes.equivalence",
    description: `${user?.name || "Usuario"} equivaló ${entry.ingredientName} en ${entry.recipeChanges.length + entry.optionChanges.length} recetas/opciones (${entry.from} a ${entry.to}${pct !== null ? `, ${pct >= 0 ? "+" : ""}${pct}%` : ""})`,
    userId: user?.id ? String(user.id) : undefined,
    userName: user?.name,
    entityId: saved.id,
    metadata: { ingredientId: entry.ingredientId, realUse: entry.realUse, expectedUse: entry.expectedUse, factor: entry.factor },
  });
  notify();
  return saved;
}

/** Regresa las recetas y opciones a como estaban antes de ese equivalado (la existencia no se toca) */
export function undoEquivalence(id: string) {
  const log = getEquivalenceLog();
  const entry = log.find((e) => e.id === id);
  if (!entry || entry.undoneAt) return false;
  const back = (c: RecipeChange) => ({ productId: c.productId, to: c.from });
  saveAdminRecipes(applyRecipeChanges(getAdminRecipes() as RecipeItem[], entry.ingredientId, entry.recipeChanges.map(back)));
  if (entry.optionChanges.length) saveAdminProducts(applyOptionChanges(getAdminProducts(), entry.optionChanges.map((o) => ({ ...o, to: o.from }))));
  localStorage.setItem(LOG_KEY, JSON.stringify(log.map((e) => (e.id === id ? { ...e, undoneAt: new Date().toISOString() } : e))));
  const user = getCurrentUser();
  addAuditEvent({ category: "Inventario", action: "recipes.equivalence_undo", description: `${user?.name || "Usuario"} regresó las recetas de ${entry.ingredientName} a como estaban antes del equivalado`, userId: user?.id ? String(user.id) : undefined, userName: user?.name, entityId: id });
  notify();
  return true;
}

/** Enlaza una opción (ej. "Salsas: BBQ" de los boneless) al insumo, para que descuente y cuente */
export function linkOptionToIngredient(target: UnlinkedOption, ingredient: { id: number; name: string; unit: string }, quantity: number) {
  saveAdminProducts(linkOption(getAdminProducts(), target, ingredient.id, quantity));
  const user = getCurrentUser();
  addAuditEvent({ category: "Inventario", action: "recipes.link_option", description: `${user?.name || "Usuario"} enlazó la opción ${target.groupName}: ${target.optionName} de ${target.productName} a ${ingredient.name} (${quantity} ${ingredient.unit} cada vez)`, userId: user?.id ? String(user.id) : undefined, userName: user?.name });
  notify();
}

/** Agrega el insumo a la receta de un producto que lo lleva y no lo tenía */
export function addIngredientToRecipe(target: UnlinkedProduct, ingredient: { id: number; name: string; unit: string }, quantity: number) {
  saveAdminRecipes(addRecipeLine(getAdminRecipes(), target.productId, ingredient.id, quantity));
  const user = getCurrentUser();
  addAuditEvent({ category: "Inventario", action: "recipes.add_line", description: `${user?.name || "Usuario"} agregó ${quantity} ${ingredient.unit} de ${ingredient.name} a la receta de ${target.productName}`, userId: user?.id ? String(user.id) : undefined, userName: user?.name });
  notify();
}
