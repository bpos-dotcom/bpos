/**
 * Productos compuestos (combos).
 *
 * Un combo tiene su propio precio y está formado por otros productos ya
 * dados de alta (Combo Original = Hamburguesa Original + Salchipapas +
 * Refresco a elegir). Al venderse:
 *  - cada parte sale en la comanda y el KDS de SU estación;
 *  - el inventario descuenta la receta de cada parte, más la receta propia
 *    del combo si tiene (bolsa, caja...);
 *  - los reportes cuentan el combo y también cuántas partes salieron.
 *
 * Las partes elegidas se guardan en la venta (`parts`), así lo vendido no
 * cambia aunque después se edite el combo.
 */
import type { KitchenStation, Product, ProductComponent } from "@/data/products";

export type SoldPart = {
  productId: number;
  name: string;
  quantity: number; // por cada combo
  station: KitchenStation;
  label?: string; // "Refresco"
};

type ItemWithParts = { id: number; quantity: number; parts?: SoldPart[] };

export function isCompound(product: Pick<Product, "components"> | undefined | null) {
  return Boolean(product?.components?.length);
}

/** Componentes que obligan a elegir al cobrar. */
export function choiceComponents(product: Product) {
  return (product.components || []).filter((c) => c.options.length > 1);
}

/**
 * Partes vendidas de un combo. `chosen`: producto elegido por componente
 * (key → id); sin elección se usa la primera opción.
 */
export function resolveParts(product: Product, products: Product[], chosen: Record<string, number> = {}): SoldPart[] {
  const byId = new Map(products.map((p) => [Number(p.id), p]));
  return (product.components || []).flatMap((component: ProductComponent) => {
    const id = chosen[component.key] ?? component.options[0];
    const part = byId.get(Number(id));
    if (!part) return [];
    return [{ productId: part.id, name: part.name, quantity: component.quantity || 1, station: part.station || "Cocina", label: component.label || undefined }];
  });
}

/** Renglón del carrito: el mismo combo con otras elecciones es otro renglón. */
export function lineIdFor(productId: number, parts?: SoldPart[]) {
  return parts?.length ? `${productId}|${parts.map((p) => p.productId).join(",")}` : String(productId);
}

/**
 * Insumos que consume una partida: su receta propia (por pieza) más la
 * receta de cada parte si es combo.
 */
export function itemConsumption(
  item: ItemWithParts,
  recipeOf: (productId: number) => { ingredientId: number; quantity: number }[]
): Map<number, number> {
  const total = new Map<number, number>();
  const add = (productId: number, times: number) => {
    for (const r of recipeOf(Number(productId))) {
      total.set(Number(r.ingredientId), (total.get(Number(r.ingredientId)) || 0) + Number(r.quantity) * times);
    }
  };
  const qty = Number(item.quantity) || 0;
  add(item.id, qty);
  (item.parts || []).forEach((part) => add(part.productId, (Number(part.quantity) || 1) * qty));
  return total;
}

/** Productos que ve la cocina: los combos se separan en sus partes, cada una con su estación. */
export function kitchenItems<T extends { id: number; name: string; quantity: number; station?: string; parts?: SoldPart[] }>(
  items: T[]
): (T & { fromCombo?: string; lineKey: string })[] {
  return items.flatMap((item, index) =>
    item.parts?.length
      ? item.parts.map((part, j) => ({
          ...item,
          name: part.name,
          quantity: (Number(part.quantity) || 1) * (Number(item.quantity) || 1),
          station: part.station,
          fromCombo: item.name,
          lineKey: `${index}-${j}`,
        }))
      : [{ ...item, lineKey: String(index) }]
  );
}
