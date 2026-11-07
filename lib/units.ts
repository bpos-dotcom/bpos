"use client";
/**
 * Unidades de los ingredientes: pza, g, kg, ml y L. Entre g y kg (o ml y L)
 * se puede cambiar y B-POS convierte todo lo que usa ese ingrediente:
 * existencia, mínimo, recetas, opciones de productos, equivalencias de
 * compra y costos (64000 g → 64 kg, 150 g en la receta → 0.15 kg).
 */
import type { Ingredient } from "@/data/inventory";
import { addAuditEvent } from "@/lib/audit";
import { getAdminIngredients, getAdminProducts, getAdminRecipes, saveAdminIngredients, saveAdminProducts, saveAdminRecipes } from "@/lib/admin";

export type Unit = Ingredient["unit"];

export const UNITS: { value: Unit; label: string }[] = [
  { value: "pza", label: "pza (piezas)" },
  { value: "g", label: "g (gramos)" },
  { value: "kg", label: "kg (kilos)" },
  { value: "ml", label: "ml (mililitros)" },
  { value: "L", label: "L (litros)" },
];

/** Cuántas unidades base vale 1 (g para peso, ml para volumen) */
const BASE: Record<Unit, { group: "pieza" | "peso" | "volumen"; size: number }> = {
  pza: { group: "pieza", size: 1 },
  g: { group: "peso", size: 1 },
  kg: { group: "peso", size: 1000 },
  ml: { group: "volumen", size: 1 },
  L: { group: "volumen", size: 1000 },
};

/** Por cuánto se multiplica una cantidad al pasar de una unidad a otra (null si no se puede: kg → pza) */
export function unitFactor(from: Unit, to: Unit): number | null {
  const a = BASE[from] || BASE.pza;
  const b = BASE[to] || BASE.pza;
  return a.group === b.group ? a.size / b.size : null;
}

/** Unidades en que se puede escribir una cantidad de un ingrediente (las de su mismo tipo) */
export function compatibleUnits(unit: Unit): Unit[] {
  const g = (BASE[unit] || BASE.pza).group;
  return (Object.keys(BASE) as Unit[]).filter((u) => BASE[u].group === g);
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Qué cambiaría al convertir (para avisar antes) */
export function unitChangeImpact(ingredientId: number) {
  const recipes = getAdminRecipes().filter((r) => Number(r.ingredientId) === Number(ingredientId)).length;
  const options = getAdminProducts().reduce(
    (n, p) =>
      n +
      (p.modifierGroups || []).reduce((m, g) => m + g.options.filter((o) => Number(o.ingredientId) === Number(ingredientId)).length, 0) +
      (p.packaging || []).filter((l) => Number(l.ingredientId) === Number(ingredientId)).length,
    0
  );
  return { recipes, options };
}

/**
 * Cambia la unidad de un ingrediente convirtiendo sus cantidades. Si las
 * unidades no son del mismo tipo (kg → pza) solo cambia la unidad.
 */
export function changeIngredientUnit(ingredientId: number, to: Unit) {
  const ingredients = getAdminIngredients();
  const current = ingredients.find((i) => Number(i.id) === Number(ingredientId));
  if (!current || current.unit === to) return current;
  const factor = unitFactor(current.unit, to);
  const next: Ingredient = { ...current, unit: to };
  if (factor !== null) {
    next.stock = round(Number(current.stock) * factor);
    next.minimum = round(Number(current.minimum) * factor);

    saveAdminRecipes(getAdminRecipes().map((r) => (Number(r.ingredientId) === Number(ingredientId) ? { ...r, quantity: round(Number(r.quantity) * factor) } : r)));
    saveAdminProducts(
      getAdminProducts().map((p) => {
        let next = p;
        if (p.modifierGroups?.some((g) => g.options.some((o) => Number(o.ingredientId) === Number(ingredientId))))
          next = {
            ...next,
            modifierGroups: p.modifierGroups.map((g) => ({
              ...g,
              options: g.options.map((o) => (Number(o.ingredientId) === Number(ingredientId) && o.quantity !== undefined ? { ...o, quantity: round(Number(o.quantity) * factor) } : o)),
            })),
          };
        // Empaque del producto
        if (p.packaging?.some((l) => Number(l.ingredientId) === Number(ingredientId)))
          next = { ...next, packaging: p.packaging.map((l) => (Number(l.ingredientId) === Number(ingredientId) ? { ...l, quantity: round(Number(l.quantity) * factor) } : l)) };
        return next;
      })
    );
    // Equivalencias de compra (cuánto trae cada presentación) y costos (precio por unidad)
    const aliases = JSON.parse(localStorage.getItem("bpos_purchase_aliases") || "[]") as { ingredientId: number; quantity: number; unit: Unit }[];
    localStorage.setItem(
      "bpos_purchase_aliases",
      JSON.stringify(aliases.map((a) => (Number(a.ingredientId) === Number(ingredientId) ? { ...a, quantity: round(Number(a.quantity) * factor), unit: to } : a)))
    );
    // Kardex: sus movimientos pasados también quedan en la unidad nueva (si no, el Kardex vería un cambio "sin registro")
    const kardex = JSON.parse(localStorage.getItem("bpos_inventory_kardex") || "[]") as { ingredientId: number; quantity: number; previousStock: number; finalStock: number; unit: Unit }[];
    localStorage.setItem(
      "bpos_inventory_kardex",
      JSON.stringify(
        kardex.map((m) =>
          Number(m.ingredientId) === Number(ingredientId)
            ? { ...m, unit: to, quantity: round(Number(m.quantity) * factor), previousStock: round(Number(m.previousStock) * factor), finalStock: round(Number(m.finalStock) * factor) }
            : m
        )
      )
    );
    const costs = JSON.parse(localStorage.getItem("bpos_ingredient_cost_history") || "[]") as { ingredientId: number; inventoryQuantity: number; unitCost: number }[];
    localStorage.setItem(
      "bpos_ingredient_cost_history",
      JSON.stringify(
        costs.map((c) => (Number(c.ingredientId) === Number(ingredientId) ? { ...c, inventoryQuantity: round(Number(c.inventoryQuantity) * factor), unitCost: round(Number(c.unitCost) / factor) } : c))
      )
    );
  }
  saveAdminIngredients(ingredients.map((i) => (Number(i.id) === Number(ingredientId) ? next : i)));
  addAuditEvent({
    category: "Inventario",
    action: "ingredient.unit",
    description: `${current.name}: unidad de ${current.unit} a ${to}${factor !== null ? ` (cantidades convertidas ×${factor})` : " (sin convertir cantidades)"}`,
    metadata: { ingredientId, from: current.unit, to, factor },
  });
  return next;
}
