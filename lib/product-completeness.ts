/**
 * ¿Está completo el producto? Para ver el avance del menú (Productos y Food
 * cost): un producto está completo con precio, receta y packaging.
 *  - Un combo (opciones enlazadas a productos) descuenta la receta de sus
 *    opciones: no necesita receta propia.
 *  - Lo que no se vende por separado (refresco del combo, "ranch aparte")
 *    no lleva precio ni packaging propios: solo receta.
 *  - Lo creado desde el Bridge pide todo, y grupos de opciones si el ticket
 *    los traía.
 */
import type { Product } from "@/data/products";
import type { RecipeItem } from "@/data/inventory";

export type Missing = "precio" | "receta" | "packaging" | "opciones";

export const MISSING_LABEL: Record<Missing, string> = { precio: "precio", receta: "receta", packaging: "packaging", opciones: "grupos de opciones" };

export function productMissing(product: Product, recipes: Pick<RecipeItem, "productId" | "quantity">[]): Missing[] {
  const missing: Missing[] = [];
  const full = !product.notSoldAlone || Boolean(product.fromBridge);
  if (full && !(Number(product.price) > 0)) missing.push("precio");
  const combo = Boolean(product.modifierGroups?.some((g) => g.options.some((o) => o.productId)));
  if (!combo && !recipes.some((r) => Number(r.productId) === Number(product.id) && Number(r.quantity) > 0)) missing.push("receta");
  if (full && !(product.packaging || []).some((l) => Number(l.quantity) > 0)) missing.push("packaging");
  if (product.fromBridge?.withOptions && !product.modifierGroups?.length) missing.push("opciones");
  return missing;
}

/** "precio, receta y packaging" */
export function missingText(missing: Missing[]) {
  const words = missing.map((m) => MISSING_LABEL[m]);
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} y ${words[words.length - 1]}` : words[0] || "";
}

/** Cuántos productos del menú están completos */
export function menuProgress(products: Product[], recipes: Pick<RecipeItem, "productId" | "quantity">[]) {
  const total = products.length;
  const done = products.filter((p) => productMissing(p, recipes).length === 0).length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 100 };
}
