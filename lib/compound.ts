/**
 * Productos compuestos (combos) y modificadores.
 *
 * Un combo tiene su propio precio y está formado por otros productos ya
 * dados de alta (Combo Original = Hamburguesa Original + Salchipapas +
 * Refresco a elegir). Al venderse:
 *  - cada parte sale en la comanda y el KDS de SU estación;
 *  - el inventario descuenta la receta de cada parte, más la receta propia
 *    del combo si tiene (bolsa, caja...);
 *  - los reportes cuentan el combo y también cuántas partes salieron.
 *
 * Modificadores: opciones que no se venden solas ("Ranch: Sí / No, gracias /
 * Aparte", "Salsas a elegir"). Pueden cobrar extra y descontar un insumo.
 * Van en el producto o en una parte de un combo.
 *
 * Lo elegido se guarda en la venta (`parts`, `modifiers`), así lo vendido no
 * cambia aunque después se edite el producto.
 */
import type { KitchenStation, ModifierGroup, Product, ProductComponent } from "@/data/products";

export type SoldModifier = {
  group: string; // "Aderezo"
  name: string; // "Ranch aparte"
  price: number; // extra por pieza
  ingredientId?: number;
  quantity?: number; // del insumo, por pieza
};

export type SoldPart = {
  productId: number;
  name: string;
  quantity: number; // por cada combo
  station: KitchenStation;
  label?: string; // "Refresco"
  modifiers?: SoldModifier[];
};

type ItemWithParts = { id: number; quantity: number; parts?: SoldPart[]; modifiers?: SoldModifier[] };

export function isCompound(product: Pick<Product, "components"> | undefined | null) {
  return Boolean(product?.components?.length);
}

/** Componentes que obligan a elegir al cobrar. */
export function choiceComponents(product: Product) {
  return (product.components || []).filter((c) => c.options.length > 1);
}

/** ¿Al agregarlo hay que preguntar algo? (parte a elegir u opciones del producto o de sus partes) */
export function needsChoices(product: Product, products: Product[]) {
  if (product.modifierGroups?.length || choiceComponents(product).length) return true;
  const byId = new Map(products.map((p) => [Number(p.id), p]));
  return (product.components || []).some((c) => byId.get(Number(c.options[0]))?.modifierGroups?.length);
}

/** Opción elegida de un grupo → lo que se guarda en la venta. */
export function soldModifiers(groups: ModifierGroup[] | undefined, chosen: Record<string, string[]>): SoldModifier[] {
  return (groups || []).flatMap((group) =>
    (chosen[group.key] || []).flatMap((optionKey) => {
      const option = group.options.find((o) => o.key === optionKey);
      if (!option) return [];
      return [
        {
          group: group.name,
          name: option.name,
          price: Number(option.price) || 0,
          ...(option.ingredientId && option.quantity ? { ingredientId: option.ingredientId, quantity: option.quantity } : {}),
        },
      ];
    })
  );
}

/** Grupo obligatorio sin elegir o con más de las permitidas (texto del problema o ""). */
export function modifierProblem(groups: ModifierGroup[] | undefined, chosen: Record<string, string[]>, owner = "") {
  for (const group of groups || []) {
    const count = (chosen[group.key] || []).length;
    const prefix = owner ? `${owner}: ` : "";
    if (count < group.min) return `${prefix}elige ${group.min > 1 ? `${group.min} opciones` : "una opción"} de ${group.name}.`;
    if (group.max > 0 && count > group.max) return `${prefix}${group.name} permite máximo ${group.max}.`;
  }
  return "";
}

/**
 * Partes vendidas de un combo. `chosen`: producto elegido por componente
 * (key → id; sin elección, la primera opción). `partModifiers`: opciones
 * elegidas de cada parte (key del componente → modificadores).
 */
export function resolveParts(
  product: Product,
  products: Product[],
  chosen: Record<string, number> = {},
  partModifiers: Record<string, SoldModifier[]> = {}
): SoldPart[] {
  const byId = new Map(products.map((p) => [Number(p.id), p]));
  return (product.components || []).flatMap((component: ProductComponent) => {
    const id = chosen[component.key] ?? component.options[0];
    const part = byId.get(Number(id));
    if (!part) return [];
    const modifiers = partModifiers[component.key];
    return [
      {
        productId: part.id,
        name: part.name,
        quantity: component.quantity || 1,
        station: part.station || "Cocina",
        label: component.label || undefined,
        ...(modifiers?.length ? { modifiers } : {}),
      },
    ];
  });
}

/** Lo que se cobra extra por pieza: opciones del producto y de sus partes. */
export function extrasPrice(modifiers?: SoldModifier[], parts?: SoldPart[]) {
  const own = (modifiers || []).reduce((s, m) => s + (Number(m.price) || 0), 0);
  const inParts = (parts || []).reduce((s, p) => s + (p.modifiers || []).reduce((n, m) => n + (Number(m.price) || 0), 0) * (Number(p.quantity) || 1), 0);
  return own + inParts;
}

/** Renglón del carrito: el mismo producto con otras elecciones es otro renglón. */
export function lineIdFor(productId: number, parts?: SoldPart[], modifiers?: SoldModifier[]) {
  const mods = (list?: SoldModifier[]) => (list || []).map((m) => `${m.group}:${m.name}`).join("+");
  const partKey = (parts || []).map((p) => `${p.productId}${p.modifiers?.length ? `(${mods(p.modifiers)})` : ""}`).join(",");
  return [String(productId), partKey, mods(modifiers)].filter(Boolean).join("|");
}

/** "Aderezo: Ranch aparte · Salsas: BBQ, Búfalo" */
export function modifiersText(modifiers?: SoldModifier[]) {
  const byGroup = new Map<string, string[]>();
  (modifiers || []).forEach((m) => byGroup.set(m.group, [...(byGroup.get(m.group) || []), m.name]));
  return [...byGroup.entries()].map(([group, names]) => `${group}: ${names.join(", ")}`).join(" · ");
}

/**
 * Insumos que consume una partida: su receta propia (por pieza), la receta
 * de cada parte si es combo y el insumo de cada opción elegida.
 */
export function itemConsumption(
  item: ItemWithParts,
  recipeOf: (productId: number) => { ingredientId: number; quantity: number }[]
): Map<number, number> {
  const total = new Map<number, number>();
  const addIngredient = (ingredientId: number, amount: number) => total.set(Number(ingredientId), (total.get(Number(ingredientId)) || 0) + amount);
  const add = (productId: number, times: number) => {
    for (const r of recipeOf(Number(productId))) addIngredient(r.ingredientId, Number(r.quantity) * times);
  };
  const addModifiers = (modifiers: SoldModifier[] | undefined, times: number) =>
    (modifiers || []).forEach((m) => m.ingredientId && m.quantity && addIngredient(m.ingredientId, Number(m.quantity) * times));

  const qty = Number(item.quantity) || 0;
  add(item.id, qty);
  addModifiers(item.modifiers, qty);
  (item.parts || []).forEach((part) => {
    const times = (Number(part.quantity) || 1) * qty;
    add(part.productId, times);
    addModifiers(part.modifiers, times);
  });
  return total;
}

/** Productos que ve la cocina: los combos se separan en sus partes, cada una con su estación y sus opciones. */
export function kitchenItems<T extends { id: number; name: string; quantity: number; station?: string; parts?: SoldPart[]; modifiers?: SoldModifier[] }>(
  items: T[]
): (T & { fromCombo?: string; lineKey: string })[] {
  return items.flatMap((item, index) =>
    item.parts?.length
      ? item.parts.map((part, j) => ({
          ...item,
          name: part.name,
          quantity: (Number(part.quantity) || 1) * (Number(item.quantity) || 1),
          station: part.station,
          modifiers: part.modifiers,
          fromCombo: item.name,
          lineKey: `${index}-${j}`,
        }))
      : [{ ...item, lineKey: String(index) }]
  );
}
