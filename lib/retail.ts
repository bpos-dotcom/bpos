"use client";
/**
 * Tienda y ferretería: artículos que ya vienen hechos (Coca-Cola, Sabritas,
 * tornillos). Cada artículo con existencias tiene su propio insumo en el
 * inventario (stockItemId) con una "receta" de 1 a 1: así la venta lo
 * descuenta, la compra lo suma, el inventario ciego lo cuenta y la lista de
 * compras lo avisa, con el mismo motor que ya usa el restaurante
 * (lib/inventory.ts). A granel la cantidad vendida lleva decimales
 * (0.250 kg, 2.5 m) y descuenta lo mismo.
 */
import type { Ingredient, RecipeItem } from "@/data/inventory";
import type { Product, RetailUnit } from "@/data/products";
import { getAdminIngredients, getAdminProducts, getAdminRecipes, saveAdminIngredients, saveAdminProducts, saveAdminRecipes } from "@/lib/admin";
import { getKardex, type InventoryMovement } from "@/lib/inventory";

export const RETAIL_UNITS: { value: RetailUnit; label: string; short: string; bulk: boolean }[] = [
  { value: "pza", label: "Pieza", short: "pza", bulk: false },
  { value: "kg", label: "Kilo", short: "kg", bulk: true },
  { value: "g", label: "Gramo", short: "g", bulk: true },
  { value: "L", label: "Litro", short: "L", bulk: true },
  { value: "m", label: "Metro", short: "m", bulk: true },
];

/** Categorías que se sugieren al dar de alta (además de las que ya tenga) */
export const SUGGESTED_RETAIL_CATEGORIES = {
  tienda: ["Abarrotes", "Bebidas", "Botanas", "Dulces", "Lácteos", "Carnicería", "Frutas y verduras", "Panadería", "Limpieza", "Higiene personal", "Cigarros", "Varios"],
  ferreteria: ["Tornillería", "Herramienta", "Eléctrico", "Plomería", "Pintura", "Construcción", "Jardinería", "Cerrajería", "Adhesivos", "Varios"],
};

export const unitOf = (p: Pick<Product, "unit">): RetailUnit => (RETAIL_UNITS.some((u) => u.value === p.unit) ? (p.unit as RetailUnit) : "pza");
export const isBulk = (p: Pick<Product, "sellBy" | "unit">) => p.sellBy === "granel" && unitOf(p) !== "pza";
export const unitShort = (unit: RetailUnit | undefined) => RETAIL_UNITS.find((u) => u.value === unit)?.short || "pza";

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** "0.25 kg", "3 pza", "2.5 m" */
export function formatQty(quantity: number, unit: RetailUnit | undefined = "pza") {
  const q = round3(quantity);
  return `${q.toLocaleString("es-MX", { maximumFractionDigits: 3 })} ${unitShort(unit)}`;
}

/** Todos los códigos de un artículo */
export const codesOf = (p: Pick<Product, "barcode" | "extraBarcodes">) => [p.barcode, ...(p.extraBarcodes || [])].map((c) => String(c || "").trim()).filter(Boolean);

/** El artículo de este código de barras (o de esta clave escrita a mano) */
export function findByBarcode<T extends Pick<Product, "barcode" | "extraBarcodes">>(products: T[], code: string): T | undefined {
  const wanted = code.replace(/\s+/g, "");
  if (!wanted) return undefined;
  return products.find((p) => codesOf(p).includes(wanted));
}

/** Otro artículo que ya tiene alguno de estos códigos (para no repetirlos) */
export function duplicateCode(products: Product[], product: Pick<Product, "id" | "barcode" | "extraBarcodes">) {
  const mine = codesOf(product);
  for (const other of products) {
    if (other.id === product.id) continue;
    const hit = codesOf(other).find((c) => mine.includes(c));
    if (hit) return { code: hit, product: other };
  }
  return null;
}

/** Precio de cada unidad según la cantidad (mayoreo desde X piezas) */
export function unitPriceFor(p: Pick<Product, "price" | "wholesale">, quantity: number) {
  const w = p.wholesale;
  if (w && w.minQty > 0 && w.price > 0 && quantity >= w.minQty) return w.price;
  return p.price;
}

/** Ganancia por unidad y margen sobre el precio (null sin costo) */
export function margin(p: Pick<Product, "price" | "cost">) {
  if (!p.cost || p.cost <= 0 || !p.price) return null;
  const profit = round2(p.price - p.cost);
  return { profit, percent: Math.round((profit / p.price) * 100) };
}

/**
 * Granel: lo que se escribe al vender. "250" en gramos o "$20" en dinero →
 * cantidad en la unidad del artículo (kg, L, m).
 */
export function bulkQuantity(p: Pick<Product, "price" | "unit">, input: { amount: number; mode: "unidad" | "chica" | "dinero" }) {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const unit = unitOf(p);
  if (input.mode === "dinero") return p.price > 0 ? round3(amount / p.price) : 0;
  // "chica": gramos para kg, mililitros para L, centímetros para m
  if (input.mode === "chica") return round3(amount / (unit === "m" ? 100 : unit === "g" ? 1 : 1000));
  return round3(amount);
}

/** Unidad chica para escribir a granel ("g" para kg) */
export function smallUnitOf(unit: RetailUnit) {
  return unit === "kg" ? "g" : unit === "L" ? "ml" : unit === "m" ? "cm" : null;
}

const INGREDIENT_UNIT: Record<RetailUnit, Ingredient["unit"]> = { pza: "pza", kg: "kg", g: "g", L: "L", m: "m" };

/**
 * Deja al día la existencia de cada artículo: crea su insumo si no tiene,
 * le pasa nombre, unidad y categoría, y su receta 1 a 1. Devuelve los
 * productos con su stockItemId puesto (guardar ESA lista).
 * `stock`: existencias escritas en la ficha (id del producto → cantidad).
 */
export function syncStockItems(products: Product[], edits: Map<number, { stock?: number; minimum?: number }> = new Map()) {
  const ingredients = getAdminIngredients();
  const recipes = getAdminRecipes();
  let nextId = ingredients.reduce((max, i) => Math.max(max, Number(i.id) || 0), 0) + 1;
  let ingredientsChanged = false;
  let recipesChanged = false;
  const changes: { ingredient: Ingredient; previous: number }[] = [];

  const next = products.map((p) => {
    // Solo artículos de tienda (sellBy); los productos de restaurante conservan su receta
    if (!p.sellBy || p.noStock || p.openPrice || p.noOwnTicket) return p;
    const unit = INGREDIENT_UNIT[unitOf(p)];
    let item = p.stockItemId ? ingredients.find((i) => Number(i.id) === Number(p.stockItemId)) : undefined;
    // Antes ligado por id de producto (otro equipo lo creó al mismo tiempo)
    if (!item) item = ingredients.find((i) => i.productId === p.id);
    const edit = edits.get(p.id);
    if (!item) {
      item = { id: nextId++, name: p.name, unit, stock: 0, minimum: 0, category: p.category, productId: p.id };
      ingredients.push(item);
      ingredientsChanged = true;
    }
    if (item.name !== p.name || item.unit !== unit || item.category !== p.category || item.productId !== p.id) {
      Object.assign(item, { name: p.name, unit, category: p.category, productId: p.id });
      ingredientsChanged = true;
    }
    if (edit?.minimum !== undefined && Number(item.minimum) !== edit.minimum) {
      item.minimum = Math.max(0, edit.minimum);
      ingredientsChanged = true;
    }
    if (edit?.stock !== undefined && Number(item.stock) !== edit.stock) {
      const previous = Number(item.stock) || 0;
      item.stock = round3(edit.stock);
      changes.push({ ingredient: { ...item }, previous });
      ingredientsChanged = true;
    }
    // Receta 1 a 1 (solo esa línea: el artículo no lleva otra cosa)
    const own = recipes.filter((r) => Number(r.productId) === Number(p.id));
    if (own.length !== 1 || Number(own[0].ingredientId) !== Number(item.id) || Number(own[0].quantity) !== 1) {
      for (let i = recipes.length - 1; i >= 0; i--) if (Number(recipes[i].productId) === Number(p.id)) recipes.splice(i, 1);
      recipes.push({ productId: p.id, ingredientId: Number(item.id), quantity: 1 } as RecipeItem);
      recipesChanged = true;
    }
    return p.stockItemId === item.id ? p : { ...p, stockItemId: Number(item.id) };
  });

  if (ingredientsChanged) saveAdminIngredients(ingredients);
  if (recipesChanged) saveAdminRecipes(recipes);
  return { products: next, stockChanges: changes };
}

/** Borra la existencia y la receta de un artículo que se elimina */
export function removeStockItem(product: Pick<Product, "id" | "stockItemId">) {
  const recipes = getAdminRecipes().filter((r) => Number(r.productId) !== Number(product.id));
  saveAdminRecipes(recipes);
  if (!product.stockItemId) return;
  // Si otro artículo todavía lo usa, se queda
  if (recipes.some((r) => Number(r.ingredientId) === Number(product.stockItemId))) return;
  saveAdminIngredients(getAdminIngredients().filter((i) => Number(i.id) !== Number(product.stockItemId)));
}

/** Existencia de un artículo (null si no lleva) */
export function stockOf(product: Pick<Product, "stockItemId">, ingredients: Ingredient[] = getAdminIngredients()) {
  if (!product.stockItemId) return null;
  return ingredients.find((i) => Number(i.id) === Number(product.stockItemId)) ?? null;
}

export type SuggestedLine = {
  product: Product;
  stock: number;
  minimum: number;
  soldPerDay: number;
  /** Cuánto pedir (en la unidad del artículo) */
  quantity: number;
  cost: number | null;
};

/**
 * Pedido sugerido: lo vendido en los últimos `days` días, para tener
 * `coverDays` días de venta más el mínimo. Agrupado por proveedor.
 */
export function suggestedOrder(products: Product[], { days = 14, coverDays = 7, now = Date.now(), kardex = getKardex(), ingredients = getAdminIngredients() }: { days?: number; coverDays?: number; now?: number; kardex?: InventoryMovement[]; ingredients?: Ingredient[] } = {}) {
  const since = now - days * 86_400_000;
  const sold = new Map<number, number>();
  for (const m of kardex) {
    if (m.type !== "Venta POS" && m.type !== "Venta plataforma") continue;
    if (new Date(m.createdAt).getTime() < since) continue;
    sold.set(Number(m.ingredientId), (sold.get(Number(m.ingredientId)) || 0) + Number(m.quantity || 0));
  }
  // Devoluciones de ventas canceladas (ajuste positivo que revierte una venta)
  for (const m of kardex) {
    if (!m.revertOf || new Date(m.createdAt).getTime() < since) continue;
    const id = Number(m.ingredientId);
    if (sold.has(id)) sold.set(id, Math.max(0, (sold.get(id) || 0) - Number(m.quantity || 0)));
  }
  const lines: SuggestedLine[] = [];
  for (const product of products) {
    const item = stockOf(product, ingredients);
    if (!item) continue;
    const perDay = (sold.get(Number(item.id)) || 0) / days;
    const target = perDay * coverDays + Number(item.minimum || 0);
    const stock = Number(item.stock) || 0;
    let quantity = target - stock;
    if (quantity <= 0) continue;
    quantity = unitOf(product) === "pza" ? Math.ceil(quantity) : round3(quantity);
    lines.push({ product, stock, minimum: Number(item.minimum) || 0, soldPerDay: round3(perDay), quantity, cost: product.cost ? round2(product.cost * quantity) : null });
  }
  const bySupplier = new Map<string, SuggestedLine[]>();
  for (const line of lines.sort((a, b) => a.product.name.localeCompare(b.product.name, "es"))) {
    const key = line.product.supplier?.trim() || "Sin proveedor";
    bySupplier.set(key, [...(bySupplier.get(key) || []), line]);
  }
  return [...bySupplier.entries()].sort((a, b) => (a[0] === "Sin proveedor" ? 1 : b[0] === "Sin proveedor" ? -1 : a[0].localeCompare(b[0], "es")));
}

/** Texto del pedido para mandarlo por WhatsApp al proveedor */
export function suggestedOrderText(businessName: string, supplier: string, lines: SuggestedLine[]) {
  return [`Pedido de ${businessName}${supplier !== "Sin proveedor" ? ` para ${supplier}` : ""}:`, ...lines.map((l) => `• ${formatQty(l.quantity, unitOf(l.product))} ${l.product.name}`)].join("\n");
}

/**
 * Compra registrada (Compras, con o sin foto del ticket): el artículo toma
 * el último costo y, si no tenía, el proveedor.
 */
export function applyPurchaseToArticles(items: { ingredientId: number; inventoryQuantity: number; lineTotal: number }[], supplier: string) {
  const products = getAdminProducts();
  let changed = false;
  const next = products.map((p) => {
    if (!p.stockItemId) return p;
    const line = items.find((i) => Number(i.ingredientId) === Number(p.stockItemId));
    if (!line) return p;
    const cost = line.lineTotal > 0 && line.inventoryQuantity > 0 ? round2(line.lineTotal / line.inventoryQuantity) : null;
    const patch: Partial<Product> = {};
    if (cost !== null && cost !== p.cost) patch.cost = cost;
    if (!p.supplier?.trim() && supplier.trim()) patch.supplier = supplier.trim();
    if (!Object.keys(patch).length) return p;
    changed = true;
    return { ...p, ...patch };
  });
  if (changed) saveAdminProducts(next);
  return changed;
}

/** Precio con su unidad si se vende a granel ("$32/kg"); por pieza, solo el precio. */
export function priceWithUnit(p: { price: number | string; sellBy?: string; unit?: string }, fmt: (n: number) => string): string {
  const unit = p.sellBy === "granel" && p.unit && p.unit !== "pza" ? `/${p.unit}` : "";
  return `${fmt(Number(p.price) || 0)}${unit}`;
}
