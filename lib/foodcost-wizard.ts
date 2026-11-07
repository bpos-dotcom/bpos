"use client";
/**
 * Food cost guiado (B-POS Servicios → Food cost): el asistente paso a paso
 * guarda lo que captura en los datos de siempre de B-POS (insumos, costo de
 * cada insumo, producto con su receta y su empaque), así el mismo producto
 * sirve en el Food cost completo y si después contrata B-POS completo.
 *
 * Además guarda por producto lo que se eligió en el asistente: food cost
 * meta, si se vende en apps de delivery, la comisión de cada app y el
 * descuento de la estrategia de precio (bpos_foodcost_plans).
 */
import type { Product } from "@/data/products";
import type { Ingredient, RecipeItem } from "@/data/inventory";
import { getAdminIngredients, getAdminProducts, getAdminRecipes, saveAdminIngredients, saveAdminProducts, saveAdminRecipes } from "@/lib/admin";
import { getIngredientCostHistory, setManualCost } from "@/lib/purchases";
import { makeCostLookup } from "@/lib/reports";
import { productCost } from "@/lib/food-cost";
import { getAppCommissions, isConfigured, netFactor } from "@/lib/app-commissions";
import { unitFactor, type Unit } from "@/lib/units";

export const DELIVERY = ["DiDi", "Uber", "Rappi"] as const;
export type DeliveryApp = (typeof DELIVERY)[number];
export const APP_STYLE: Record<DeliveryApp, { color: string; text: string; letter: string }> = {
  DiDi: { color: "#FC6B2D", text: "#fff", letter: "D" },
  Uber: { color: "#06C167", text: "#000", letter: "U" },
  Rappi: { color: "#FF441F", text: "#fff", letter: "R" },
};

export type AppFee = { on: boolean; commission: number; taxes: number };
export type FoodCostPlan = {
  /** Food cost meta (%): con él se sugiere el precio */
  target: number;
  delivery: boolean;
  apps: Record<DeliveryApp, AppFee>;
  /** % de descuento de la estrategia agresiva en apps */
  discount: number;
  updatedAt: string;
};

const PLANS_KEY = "bpos_foodcost_plans";
export const FOODCOST_PLANS_EVENT = "bpos:foodcost-plans-updated";

/** Comisión de fábrica de las apps (30% + 18% de impuestos sobre lo que queda), o la configurada en Finanzas */
export function defaultApps(): Record<DeliveryApp, AppFee> {
  const saved = getAppCommissions();
  return Object.fromEntries(
    DELIVERY.map((app) => {
      const c = saved[app];
      return [app, isConfigured(c) ? { on: true, commission: Number(c.commission) || 0, taxes: Number(c.taxes) || 0 } : { on: true, commission: 30, taxes: 18 }];
    })
  ) as Record<DeliveryApp, AppFee>;
}

export const defaultPlan = (): FoodCostPlan => ({ target: 30, delivery: false, apps: defaultApps(), discount: 30, updatedAt: "" });

export function getPlans(): Record<string, FoodCostPlan> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(PLANS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function savePlan(productId: number, plan: FoodCostPlan) {
  localStorage.setItem(PLANS_KEY, JSON.stringify({ ...getPlans(), [String(productId)]: { ...plan, updatedAt: new Date().toISOString() } }));
  window.dispatchEvent(new Event(FOODCOST_PLANS_EVENT));
}

/** Qué parte de lo que paga el cliente te llega de una app (0.574 = 57.4%) */
export const appNet = (fee: AppFee) => netFactor({ commission: fee.commission, taxes: fee.taxes });

/** Precio sugerido para que el costo sea el food cost meta (redondeado al peso hacia arriba) */
export const suggestedPrice = (cost: number, target: number) => (cost > 0 && target > 0 ? Math.ceil(cost / (target / 100)) : 0);

/**
 * En una app: a cuánto venderlo para recibir lo mismo que en el local, y la
 * estrategia agresiva (precio publicado más alto con descuento).
 */
export function appPricing(localPrice: number, cost: number, fee: AppFee, discount: number) {
  const net = appNet(fee);
  const same = net > 0 ? Math.ceil(localPrice / net) : 0; // el cliente paga esto y tú recibes tu precio de local
  const d = Math.min(90, Math.max(0, discount)) / 100;
  const listed = d < 1 ? Math.ceil(same / (1 - d)) : same; // publicado; con el descuento queda en `same`
  // Publicado más caro para que con el descuento quede en tu precio de local (ej. $180 → $126): lo que recibes
  const listedToLocal = d < 1 ? Math.ceil(localPrice / (1 - d)) : localPrice;
  // Lo que pasa si publicas tu precio de local con descuento (lo que hacen muchos): cuánto recibes de verdad
  const localWithDiscount = localPrice * (1 - d);
  return {
    net,
    same,
    listed,
    receivedSame: same * net,
    foodCostSame: same * net > 0 ? (cost / (same * net)) * 100 : 0,
    listedToLocal,
    receivedToLocal: localPrice * net,
    foodCostToLocal: localPrice * net > 0 ? (cost / (localPrice * net)) * 100 : 0,
    localWithDiscount,
    receivedLocalDiscount: localWithDiscount * net,
    foodCostLocalDiscount: localWithDiscount * net > 0 ? (cost / (localWithDiscount * net)) * 100 : 0,
  };
}

// ------------------------------------------------------------ productos del asistente

export type WizardItem = {
  /** Insumo existente, o null si es nuevo */
  ingredientId: number | null;
  name: string;
  kind: "ingrediente" | "empaque";
  /** Cantidad por porción, en `unit` */
  quantity: number;
  unit: Unit;
  /** Costo: pagué `total` por `packages` paquetes de `perPackage` `packageUnit` (vacío = usar el costo que ya tiene) */
  total: number;
  packages: number;
  perPackage: number;
  packageUnit: Unit;
};

export type WizardDraft = { productId: number | null; name: string; category: string; price: number; items: WizardItem[] };

/** Costo por unidad de un renglón del asistente (el que capturó o el último que tiene el insumo) */
export function itemUnitCost(item: WizardItem, costAt: (id: number) => number) {
  const qty = item.packages * item.perPackage;
  if (item.total > 0 && qty > 0) {
    const factor = unitFactor(item.packageUnit, item.unit);
    if (factor === null) return 0;
    return item.total / (qty * factor);
  }
  return item.ingredientId ? costAt(item.ingredientId) : 0;
}

export const costLookup = () => makeCostLookup(getIngredientCostHistory());

/** Costo de una porción con lo capturado en el asistente */
export function draftCost(draft: WizardDraft) {
  const costAt = costLookup();
  const lines = draft.items.map((i) => ({ item: i, cost: itemUnitCost(i, (id) => costAt(id)) * (Number(i.quantity) || 0) }));
  return {
    lines,
    recipe: lines.filter((l) => l.item.kind === "ingrediente").reduce((s, l) => s + l.cost, 0),
    packaging: lines.filter((l) => l.item.kind === "empaque").reduce((s, l) => s + l.cost, 0),
    total: lines.reduce((s, l) => s + l.cost, 0),
  };
}

/** Lo capturado en el asistente para un producto que ya existe (para editarlo) */
export function draftFromProduct(product: Product): WizardDraft {
  const ingredients = getAdminIngredients();
  const byId = new Map(ingredients.map((i) => [Number(i.id), i]));
  const line = (id: number, quantity: number, kind: WizardItem["kind"]): WizardItem => {
    const ing = byId.get(Number(id));
    return { ingredientId: Number(id), name: ing?.name || "", kind, quantity, unit: (ing?.unit || "pza") as Unit, total: 0, packages: 1, perPackage: 0, packageUnit: (ing?.unit || "pza") as Unit };
  };
  return {
    productId: product.id,
    name: product.name,
    category: product.category,
    price: Number(product.price) || 0,
    items: [
      ...getAdminRecipes()
        .filter((r) => Number(r.productId) === Number(product.id))
        .map((r) => line(r.ingredientId, r.quantity, "ingrediente")),
      ...(product.packaging || []).map((p) => line(p.ingredientId, p.quantity, "empaque")),
    ],
  };
}

/**
 * Guarda el producto del asistente en B-POS: insumos nuevos, su costo
 * (como "costo puesto a mano"), el producto con su precio, su receta y su empaque.
 */
export function saveDraft(draft: WizardDraft): Product {
  const ingredients = getAdminIngredients();
  const ids = new Map<WizardItem, number>();
  let nextId = Date.now();
  const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  for (const item of draft.items) {
    let ing = item.ingredientId ? ingredients.find((i) => Number(i.id) === Number(item.ingredientId)) : ingredients.find((i) => sameName(i.name, item.name));
    if (!ing) {
      ing = { id: nextId++, name: item.name.trim(), unit: item.unit, stock: 0, minimum: 0, ...(item.kind === "empaque" ? { kind: "packaging" as const } : {}) } as Ingredient;
      ingredients.push(ing);
    }
    ids.set(item, Number(ing.id));
  }
  saveAdminIngredients(ingredients);

  // Costo capturado: queda como el costo más reciente del insumo
  for (const item of draft.items) {
    const qty = item.packages * item.perPackage;
    if (!(item.total > 0 && qty > 0)) continue;
    const ing = ingredients.find((i) => Number(i.id) === ids.get(item))!;
    const factor = unitFactor(item.packageUnit, ing.unit as Unit);
    if (factor === null) continue;
    setManualCost({ ingredientId: Number(ing.id), ingredientName: ing.name, unit: ing.unit, packages: item.packages, perPackage: item.perPackage * factor, total: item.total });
  }

  const products = getAdminProducts();
  const existing = draft.productId ? products.find((p) => p.id === draft.productId) : undefined;
  const qtyIn = (item: WizardItem) => {
    const ing = ingredients.find((i) => Number(i.id) === ids.get(item))!;
    const factor = unitFactor(item.unit, ing.unit as Unit) ?? 1;
    return Math.round(item.quantity * factor * 1e6) / 1e6;
  };
  const packaging = draft.items.filter((i) => i.kind === "empaque" && i.quantity > 0).map((i) => ({ ingredientId: ids.get(i)!, quantity: qtyIn(i) }));
  const product: Product = existing
    ? { ...existing, name: draft.name.trim(), category: draft.category.trim() || existing.category, price: draft.price, packaging }
    : { id: Date.now() + 999, name: draft.name.trim(), category: draft.category.trim() || "Platillos", price: draft.price, emoji: "🍽️", station: "Cocina", packaging };
  saveAdminProducts(existing ? products.map((p) => (p.id === product.id ? product : p)) : [...products, product]);

  const recipes = getAdminRecipes().filter((r) => Number(r.productId) !== Number(product.id));
  const mine: RecipeItem[] = draft.items.filter((i) => i.kind === "ingrediente" && i.quantity > 0).map((i) => ({ productId: product.id, ingredientId: ids.get(i)!, quantity: qtyIn(i) }));
  saveAdminRecipes([...recipes, ...mine]);
  return product;
}

/** Costo actual de un producto (receta + empaque, con el último costo de cada insumo) */
export function currentCost(product: Product) {
  const costAt = costLookup();
  const ingredients = new Map(getAdminIngredients().map((i) => [Number(i.id), i]));
  return productCost(product, getAdminRecipes(), ingredients, (id) => costAt(id));
}
