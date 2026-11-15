/**
 * Equivalador de insumos: repara las recetas de lo que se sirve "a ojo"
 * (lechuga, tomate, cátsup, mayonesa...).
 *
 * En un rango de fechas:
 *   gastado real    = inició con + compras − mermas − realmente quedó
 *   según la receta = lo que dicen las recetas actuales por lo vendido
 * Si se gastó 20% más de lo que dicen las recetas, cada receta que lleva ese
 * insumo sube 20% (cada producto conserva su proporción: la ensalada sigue
 * llevando más lechuga que la hamburguesa). Si ninguna receta tiene todavía
 * cantidad, se reparte parejo entre lo vendido (8 lechugas / 300 = 0.027).
 *
 * Todo aquí es cálculo puro (sin guardar nada) para poder probarlo.
 */
import type { Ingredient, RecipeItem } from "@/data/inventory";
import type { Product } from "@/data/products";
import type { InventoryMovement } from "@/lib/inventory";
import type { SoldModifier, SoldPart } from "@/lib/compound";

type Move = Pick<InventoryMovement, "ingredientId" | "type" | "quantity" | "previousStock" | "finalStock" | "createdAt"> & {
  reason?: string;
  revertOf?: string;
};

const time = (iso: string) => Date.parse(iso) || 0;
const isPurchaseMove = (m: Move) => m.type === "Ajuste positivo" && /^C-\d{3,}/.test(m.reason || "");

function movesOf(kardex: Move[], ingredientId: number) {
  return kardex
    .map((m, i) => [m, i] as const)
    .filter(([m]) => Number(m.ingredientId) === Number(ingredientId) && m.type !== "Sin registro")
    .sort((a, b) => time(a[0].createdAt) - time(b[0].createdAt) || a[1] - b[1])
    .map(([m]) => m);
}

/** Existencia que tenía el sistema justo en ese momento (según el Kardex) */
export function stockAt(kardex: Move[], ingredientId: number, at: Date, currentStock: number) {
  const moves = movesOf(kardex, ingredientId);
  const t = at.getTime();
  let before: Move | undefined;
  for (const m of moves) {
    if (time(m.createdAt) < t) before = m;
    else return before ? Number(before.finalStock) : Number(m.previousStock);
  }
  return before ? Number(before.finalStock) : Number(currentStock);
}

export type PeriodMoves = {
  purchases: number;
  waste: number;
  /** Ajustes a mano (no compras ni devoluciones de venta): solo para avisar */
  manualIn: number;
  manualOut: number;
};

/** Compras, mermas y ajustes a mano de ese insumo entre `from` (incluido) y `to` (sin incluir) */
export function periodMoves(kardex: Move[], ingredientId: number, from: Date, to: Date): PeriodMoves {
  const out: PeriodMoves = { purchases: 0, waste: 0, manualIn: 0, manualOut: 0 };
  for (const m of movesOf(kardex, ingredientId)) {
    const t = time(m.createdAt);
    if (t < from.getTime() || t >= to.getTime()) continue;
    const q = Math.abs(Number(m.quantity) || 0);
    if (isPurchaseMove(m)) out.purchases += q;
    else if (m.type === "Merma") out.waste += q;
    else if (m.revertOf) continue;
    else if (m.type === "Ajuste positivo") out.manualIn += q;
    else if (m.type === "Ajuste negativo") out.manualOut += q;
  }
  return out;
}

export type EquivalenceOrder = {
  id?: number | string;
  createdAt?: string;
  cancelled?: boolean;
  pendingPayment?: boolean;
  items?: Array<{ id: number; name?: string; quantity: number; parts?: SoldPart[]; modifiers?: SoldModifier[] }>;
  bridgeActions?: { inventoryAdjustments?: Array<{ ingredientId: string | number; quantity: number }> };
};

export type ExpectedUse = {
  /** Lo que se debió gastar según las recetas actuales */
  total: number;
  /** De eso, lo que sale de las recetas (lo que se puede reparar) */
  fromRecipes: number;
  /** De opciones (extra lechuga...) y ajustes de pedidos de plataformas */
  fromOptions: number;
  fixed: number;
  /** Piezas vendidas de cada producto cuya receta lleva el insumo (también dentro de combos) */
  units: Map<number, number>;
  /** Veces que se eligió cada opción que descuenta ese insumo */
  options: Map<string, { name: string; times: number; amount: number }>;
};

/** Ventas válidas: cobradas, no canceladas, dentro del rango */
export function salesInRange<T extends EquivalenceOrder>(orders: T[], from: Date, to: Date) {
  return orders.filter((o) => {
    if (!o || o.cancelled || o.pendingPayment || typeof o.createdAt !== "string") return false;
    const t = time(o.createdAt);
    return t >= from.getTime() && t < to.getTime();
  });
}

export function expectedUse(orders: EquivalenceOrder[], ingredientId: number, recipes: RecipeItem[]): ExpectedUse {
  const perProduct = new Map<number, number>();
  for (const r of recipes) if (Number(r.ingredientId) === Number(ingredientId)) perProduct.set(Number(r.productId), (perProduct.get(Number(r.productId)) || 0) + (Number(r.quantity) || 0));
  const res: ExpectedUse = { total: 0, fromRecipes: 0, fromOptions: 0, fixed: 0, units: new Map(), options: new Map() };
  const addProduct = (productId: number, times: number) => {
    if (!perProduct.has(Number(productId)) || !(times > 0)) return;
    res.units.set(Number(productId), (res.units.get(Number(productId)) || 0) + times);
    res.fromRecipes += (perProduct.get(Number(productId)) || 0) * times;
  };
  const addModifiers = (mods: SoldModifier[] | undefined, times: number) => {
    for (const m of mods || []) {
      if (Number(m.ingredientId) !== Number(ingredientId) || !m.quantity || !(times > 0)) continue;
      const amount = Number(m.quantity) * times;
      const key = `${m.group}|${m.name}`;
      const prev = res.options.get(key) || { name: `${m.group}: ${m.name}`, times: 0, amount: 0 };
      res.options.set(key, { name: prev.name, times: prev.times + times, amount: prev.amount + amount });
      res.fromOptions += amount;
    }
  };
  for (const order of orders) {
    for (const item of order.items || []) {
      const qty = Number(item.quantity) || 0;
      if (qty <= 0) continue;
      addProduct(item.id, qty);
      addModifiers(item.modifiers, qty);
      for (const part of item.parts || []) {
        const times = (Number(part.quantity) || 1) * qty;
        addProduct(part.productId, times);
        addModifiers(part.modifiers, times);
      }
    }
    for (const a of order.bridgeActions?.inventoryAdjustments || []) {
      if (Number(a.ingredientId) === Number(ingredientId)) res.fixed += Math.max(0, Number(a.quantity) || 0);
    }
  }
  res.total = res.fromRecipes + res.fromOptions + res.fixed;
  return res;
}

/** Redondeo según la unidad: gramos y mililitros con 1 decimal, piezas/kg/litros con 4 */
export function roundQty(n: number, unit: Ingredient["unit"]) {
  const d = unit === "g" || unit === "ml" ? 10 : 10000;
  return Math.round(n * d) / d;
}

export type RecipeChange = { productId: number; name: string; from: number; to: number; sold: number };
export type OptionChange = { productId: number; productName: string; groupKey: string; optionKey: string; name: string; from: number; to: number };

export type EquivalenceProposal = {
  mode: "proporcional" | "parejo" | "ninguno";
  /** Gastado real / según la receta (1.2 = se gastó 20% más) */
  factor: number;
  recipeChanges: RecipeChange[];
  optionChanges: OptionChange[];
  /** Por qué no se puede proponer nada (mode "ninguno") */
  reason?: string;
};

/**
 * Nuevas cantidades para que lo que dicen las recetas sea lo que de verdad
 * se gastó. Cambia todas las recetas y opciones que llevan ese insumo.
 */
export function proposeEquivalence(input: {
  ingredient: Pick<Ingredient, "id" | "unit">;
  realUse: number;
  expected: ExpectedUse;
  recipes: RecipeItem[];
  products: Product[];
}): EquivalenceProposal {
  const { ingredient, realUse, expected, recipes, products } = input;
  const id = Number(ingredient.id);
  const nameOf = new Map(products.map((p) => [Number(p.id), p.name]));
  const lines = recipes.filter((r) => Number(r.ingredientId) === id);
  const none = (reason: string): EquivalenceProposal => ({ mode: "ninguno", factor: 1, recipeChanges: [], optionChanges: [], reason });
  if (!Number.isFinite(realUse)) return none("Faltan números.");
  if (realUse < 0) return none("Lo que quedó es más de lo que tenías más lo que compraste: revisa los números.");
  const optionsInCatalog: OptionChange[] = [];
  for (const p of products) {
    for (const g of p.modifierGroups || []) {
      for (const o of g.options || []) {
        if (Number(o.ingredientId) === id && Number(o.quantity) > 0) {
          optionsInCatalog.push({ productId: Number(p.id), productName: p.name, groupKey: g.key, optionKey: o.key, name: `${g.name}: ${o.name}`, from: Number(o.quantity), to: Number(o.quantity) });
        }
      }
    }
  }
  if (!lines.length && !optionsInCatalog.length) return none("Ningún producto lleva este insumo en su receta. Agrégalo primero en la receta de los productos que lo llevan.");
  const scalable = expected.fromRecipes + expected.fromOptions;
  const target = realUse - expected.fixed;
  const totalUnits = [...expected.units.values()].reduce((a, b) => a + b, 0);
  if (scalable > 0) {
    const factor = Math.max(0, target) / scalable;
    return {
      mode: "proporcional",
      factor,
      recipeChanges: lines.map((r) => ({
        productId: Number(r.productId),
        name: nameOf.get(Number(r.productId)) || `Producto ${r.productId}`,
        from: Number(r.quantity) || 0,
        to: roundQty((Number(r.quantity) || 0) * factor, ingredient.unit),
        sold: expected.units.get(Number(r.productId)) || 0,
      })),
      optionChanges: optionsInCatalog.map((o) => ({ ...o, to: roundQty(o.from * factor, ingredient.unit) })),
    };
  }
  if (lines.length && totalUnits > 0) {
    const perUnit = roundQty(Math.max(0, target) / totalUnits, ingredient.unit);
    return {
      mode: "parejo",
      factor: 0,
      recipeChanges: lines
        .filter((r) => (expected.units.get(Number(r.productId)) || 0) > 0)
        .map((r) => ({ productId: Number(r.productId), name: nameOf.get(Number(r.productId)) || `Producto ${r.productId}`, from: Number(r.quantity) || 0, to: perUnit, sold: expected.units.get(Number(r.productId)) || 0 })),
      optionChanges: [],
    };
  }
  return none("En esas fechas no se vendió nada que lleve este insumo.");
}

/** Avisos para no corregir con una semana rara */
export function equivalenceWarnings(input: { realUse: number; expected: ExpectedUse; proposal: EquivalenceProposal; endIsSystem: boolean; manualIn: number; manualOut: number; unit: string }) {
  const w: string[] = [];
  const sold = [...input.expected.units.values()].reduce((a, b) => a + b, 0) + [...input.expected.options.values()].reduce((a, b) => a + b.times, 0);
  if (input.endIsSystem) w.push("El final \"según el sistema\" sale de tus mismas recetas, por eso no muestra diferencia. Pon en Personalizado lo que realmente quedó.");
  if (sold > 0 && sold < 20) w.push(`Solo se vendieron ${sold} productos con este insumo: el resultado puede no ser confiable. Mejor usa más días.`);
  if (input.proposal.mode === "proporcional" && (input.proposal.factor > 2 || input.proposal.factor < 0.5)) {
    w.push("El cambio es muy grande. Puede ser una merma sin registrar, una compra sin capturar o un conteo mal hecho, no la receta.");
  }
  if (input.manualIn > 0 || input.manualOut > 0) {
    const parts = [input.manualIn > 0 ? `+${input.manualIn} ${input.unit}` : "", input.manualOut > 0 ? `−${input.manualOut} ${input.unit}` : ""].filter(Boolean).join(" y ");
    w.push(`En esas fechas hubo ajustes a mano (${parts}). No cuentan en la cuenta; si alguno fue mercancía que llegó sin capturar la compra, súmalo en "Compras".`);
  }
  return w;
}

/** Recetas con las cantidades nuevas (no toca las demás) */
export function applyRecipeChanges(recipes: RecipeItem[], ingredientId: number, changes: Pick<RecipeChange, "productId" | "to">[]) {
  const to = new Map(changes.map((c) => [Number(c.productId), c.to]));
  return recipes.map((r) => (Number(r.ingredientId) === Number(ingredientId) && to.has(Number(r.productId)) ? { ...r, quantity: to.get(Number(r.productId))! } : r));
}

/** Productos con las opciones (extra lechuga...) en la cantidad nueva */
export function applyOptionChanges(products: Product[], changes: Pick<OptionChange, "productId" | "groupKey" | "optionKey" | "to">[]) {
  if (!changes.length) return products;
  const key = (p: number, g: string, o: string) => `${p}|${g}|${o}`;
  const to = new Map(changes.map((c) => [key(Number(c.productId), c.groupKey, c.optionKey), c.to]));
  return products.map((p) => {
    if (!(p.modifierGroups || []).some((g) => g.options.some((o) => to.has(key(Number(p.id), g.key, o.key))))) return p;
    return {
      ...p,
      modifierGroups: (p.modifierGroups || []).map((g) => ({
        ...g,
        options: g.options.map((o) => (to.has(key(Number(p.id), g.key, o.key)) ? { ...o, quantity: to.get(key(Number(p.id), g.key, o.key))! } : o)),
      })),
    };
  });
}
