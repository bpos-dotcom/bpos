/**
 * Opciones para elegir (modificadores) y combos.
 *
 * Cada producto puede tener grupos de opciones ("Salsas", "Refresco",
 * "Aderezo"). Una opción es:
 *  - solo texto ("Bañado", "No, gracias"): puede descontar un insumo;
 *  - enlazada a un producto existente ("Coca-Cola"): descuenta la receta de
 *    ese producto, sale en la comanda de SU estación y cuenta en reportes.
 * Cada grupo trae unas incluidas gratis y cobra solo las de más.
 *
 * Un combo es un producto con opciones enlazadas (Hamburguesa, Papas,
 * Refresco) que no manda comanda propia (`noOwnTicket`).
 *
 * En la venta se guarda lo elegido: las opciones enlazadas como `parts`
 * (producto, cantidad, estación) y el resto como `modifiers`. Así lo vendido
 * no cambia aunque después se edite el producto.
 */
import type { KitchenStation, ModifierGroup, ModifierOption, Product } from "@/data/products";

export type SoldModifier = {
  group: string; // "Aderezo"
  name: string; // "Ranch aparte"
  price: number; // lo que se cobra por pieza (solo en el renglón de extras)
  ingredientId?: number;
  quantity?: number; // del insumo, por pieza
  /** Renglón de cobro: "Salsas extra (1)" */
  extra?: number;
  /** Opción enlazada a un producto (se guarda en la venta como parte) */
  productId?: number;
  station?: KitchenStation;
};

export type SoldPart = {
  productId: number;
  name: string;
  quantity: number; // por cada pieza del producto vendido
  station: KitchenStation;
  label?: string; // grupo: "Refresco"
  modifiers?: SoldModifier[]; // opciones de ese producto (ej. salsas de los boneless del combo)
};

type ItemWithParts = { id: number; quantity: number; parts?: SoldPart[]; modifiers?: SoldModifier[] };
type Picks = Record<string, string[]>; // grupo → keys elegidas (pueden repetirse)

const newKey = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// ------------------------------------------------------------ grupos

/** Grupo que se llena solo: obligatorio con una sola opción (ej. la hamburguesa fija del combo). */
export function isAutoGroup(group: ModifierGroup) {
  return group.min > 0 && group.options.length === 1;
}

/** Elecciones que ya vienen hechas al abrir la ventana. */
export function autoPicks(groups: ModifierGroup[] | undefined): Picks {
  return Object.fromEntries((groups || []).filter(isAutoGroup).map((g) => [g.key, Array(g.min).fill(g.options[0].key)]));
}

/** ¿Al agregarlo hay que preguntar algo? */
export function needsChoices(product: Product, products: Product[]) {
  const groups = product.modifierGroups || [];
  if (groups.some((g) => !isAutoGroup(g))) return true;
  // Lo fijo puede ser un producto con sus propias opciones (los boneless del combo y sus salsas)
  const byId = new Map(products.map((p) => [Number(p.id), p]));
  return groups.some((g) => g.options.some((o) => o.productId && byId.get(Number(o.productId))?.modifierGroups?.length));
}

/** Cuántas de más eligió en un grupo (las que pasan de las incluidas). */
export function extraCount(group: ModifierGroup, picked: number) {
  return Math.max(0, picked - (Number(group.included) || 0));
}

/** Grupo obligatorio sin elegir o pasado del tope (texto del problema o ""). */
export function modifierProblem(groups: ModifierGroup[] | undefined, chosen: Picks, owner = "") {
  for (const group of groups || []) {
    const count = (chosen[group.key] || []).length;
    const prefix = owner ? `${owner}: ` : "";
    if (count < group.min) return `${prefix}elige ${group.min > 1 ? `${group.min} opciones` : "una opción"} de ${group.name}.`;
    if (group.max > 0 && count > group.max) return `${prefix}${group.name} permite máximo ${group.max}.`;
  }
  return "";
}

/** Nombre a mostrar de una opción (la enlazada toma el nombre actual del producto). */
export function optionName(option: ModifierOption, products: Product[]) {
  if (!option.productId) return option.name;
  return products.find((p) => Number(p.id) === Number(option.productId))?.name || option.name;
}

// ------------------------------------------------------------ venta

/**
 * Opciones elegidas → lo que se guarda en la venta. Si pasa de las
 * incluidas se agrega un renglón de cobro "Salsas extra (n)".
 */
export function soldModifiers(groups: ModifierGroup[] | undefined, chosen: Picks, products: Product[] = []): SoldModifier[] {
  const byId = new Map(products.map((p) => [Number(p.id), p]));
  return (groups || []).flatMap((group) => {
    const picked: SoldModifier[] = (chosen[group.key] || []).flatMap((optionKey): SoldModifier[] => {
      const option = group.options.find((o) => o.key === optionKey);
      if (!option) return [];
      const linked = option.productId ? byId.get(Number(option.productId)) : undefined;
      if (linked) return [{ group: group.name, name: linked.name, price: 0, productId: linked.id, station: linked.station || "Cocina" }];
      return [
        {
          group: group.name,
          name: option.name,
          price: 0,
          ...(option.ingredientId && option.quantity ? { ingredientId: option.ingredientId, quantity: option.quantity } : {}),
        },
      ];
    });
    const extras = extraCount(group, picked.length);
    const charge = extras && Number(group.extraPrice) > 0 ? [{ group: group.name, name: `${group.name} extra (${extras})`, price: extras * Number(group.extraPrice), extra: extras }] : [];
    return [...picked, ...charge];
  });
}

/**
 * Separa lo elegido: las opciones enlazadas a productos pasan a `parts`
 * (juntas por producto; con las opciones propias de ese producto si las
 * eligió) y lo demás queda en `modifiers`.
 */
export function splitLinked(modifiers: SoldModifier[], partModifiers: Record<number, SoldModifier[]> = {}) {
  const parts: SoldPart[] = [];
  const rest: SoldModifier[] = [];
  for (const m of modifiers) {
    if (!m.productId) {
      rest.push(m);
      continue;
    }
    const existing = parts.find((p) => p.productId === m.productId && p.label === m.group);
    if (existing) existing.quantity += 1;
    else {
      const own = partModifiers[m.productId];
      parts.push({ productId: m.productId, name: m.name, quantity: 1, station: m.station || "Cocina", label: m.group, ...(own?.length ? { modifiers: own } : {}) });
    }
  }
  return { parts, modifiers: rest };
}

/** Dueño de las opciones en la ventana del POS: el producto mismo o un producto enlazado elegido. */
export const OWN_OPTIONS = "__producto";
export const linkedOwner = (productId: number) => `p:${productId}`;

/** Productos enlazados elegidos que tienen sus propias opciones (ej. los boneless del combo y sus salsas). */
export function linkedWithOptions(product: Product, products: Product[], ownPicks: Picks): Product[] {
  const byId = new Map(products.map((p) => [Number(p.id), p]));
  const ids = new Set<number>();
  for (const group of product.modifierGroups || []) {
    for (const key of ownPicks[group.key] || []) {
      const id = group.options.find((o) => o.key === key)?.productId;
      if (id && byId.get(Number(id))?.modifierGroups?.length) ids.add(Number(id));
    }
  }
  return [...ids].map((id) => byId.get(id)!);
}

/**
 * Lo que se vende de un producto con las elecciones hechas
 * (`picks`: dueño → grupo → opciones). Sin elección en un grupo que se
 * llena solo, se usa lo automático.
 */
export function buildSelection(product: Product, products: Product[], picks: Record<string, Picks> = {}) {
  const own = { ...autoPicks(product.modifierGroups), ...(picks[OWN_OPTIONS] || {}) };
  const partModifiers: Record<number, SoldModifier[]> = {};
  for (const linked of linkedWithOptions(product, products, own)) {
    const chosen = { ...autoPicks(linked.modifierGroups), ...(picks[linkedOwner(linked.id)] || {}) };
    partModifiers[linked.id] = soldModifiers(linked.modifierGroups, chosen, products).filter((m) => !m.productId);
  }
  const { parts, modifiers } = splitLinked(soldModifiers(product.modifierGroups, own, products), partModifiers);
  return {
    parts: parts.length ? parts : undefined,
    modifiers: modifiers.length ? modifiers : undefined,
    ownTicket: !product.noOwnTicket,
  };
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
  const partKey = (parts || []).map((p) => `${p.productId}x${p.quantity}${p.modifiers?.length ? `(${mods(p.modifiers)})` : ""}`).join(",");
  return [String(productId), partKey, mods(modifiers)].filter(Boolean).join("|");
}

/** Las opciones elegidas juntando repetidas: [{ name: "BBQ", qty: 2 }, ...] (sin el renglón de cobro). */
export function groupedPicks(modifiers?: SoldModifier[]) {
  const rows: { group: string; name: string; qty: number }[] = [];
  (modifiers || [])
    .filter((m) => !m.extra)
    .forEach((m) => {
      const row = rows.find((r) => r.group === m.group && r.name === m.name);
      if (row) row.qty += 1;
      else rows.push({ group: m.group, name: m.name, qty: 1 });
    });
  return rows;
}

/** "Aderezo: Ranch aparte · Salsas: 2x BBQ, Búfalo" */
export function modifiersText(modifiers?: SoldModifier[]) {
  const byGroup = new Map<string, string[]>();
  groupedPicks(modifiers).forEach((r) => byGroup.set(r.group, [...(byGroup.get(r.group) || []), `${r.qty > 1 ? `${r.qty}x ` : ""}${r.name}`]));
  return [...byGroup.entries()].map(([group, names]) => `${group}: ${names.join(", ")}`).join(" · ");
}

/**
 * Insumos que consume una partida: su receta propia (por pieza), la receta
 * de cada producto enlazado y el insumo de cada opción de texto.
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

/**
 * Productos que ve la cocina: cada producto enlazado sale aparte en su
 * estación; el producto mismo también sale en la suya salvo que sea un combo
 * sin comanda propia (`ownTicket` falso).
 */
export function kitchenItems<T extends { id: number; name: string; quantity: number; station?: string; parts?: SoldPart[]; modifiers?: SoldModifier[]; ownTicket?: boolean }>(
  items: T[]
): (T & { fromCombo?: string; lineKey: string })[] {
  return items.flatMap((item, index) => {
    if (!item.parts?.length) return [{ ...item, lineKey: String(index) }];
    const own = item.ownTicket ? [{ ...item, lineKey: `${index}` }] : [];
    return [
      ...own,
      ...item.parts.map((part, j) => {
        // En un combo sin comanda propia, las notas del combo viajan con cada parte
        const modifiers = [...(part.modifiers || []), ...(item.ownTicket ? [] : (item.modifiers || []).filter((m) => !m.extra))];
        return {
          ...item,
          name: part.name,
          quantity: (Number(part.quantity) || 1) * (Number(item.quantity) || 1),
          station: part.station,
          modifiers: modifiers.length ? modifiers : undefined,
          fromCombo: item.name,
          lineKey: `${index}-${j}`,
        };
      }),
    ];
  });
}

// ------------------------------------------------------------ editor

/** Copia independiente de grupos de otro producto (claves nuevas). */
export function copyGroups(groups: ModifierGroup[], fromProductName: string): ModifierGroup[] {
  return groups.map((g) => ({
    ...g,
    key: newKey("g"),
    options: g.options.map((o) => ({ ...o, key: newKey("o") })),
    copiedFrom: { productName: fromProductName, edited: false },
  }));
}

/**
 * 1.10 → 1.12: las partes de un combo (`components`) pasan a ser grupos de
 * opciones enlazadas (obligatorios, con su cantidad incluida) y el combo
 * deja de mandar comanda propia. Regresa null si no había nada que convertir.
 */
export function migrateComponents(products: Product[]): Product[] | null {
  if (!products.some((p) => p.components?.length)) return null;
  const byId = new Map(products.map((p) => [Number(p.id), p]));
  return products.map((product) => {
    if (!product.components?.length) return product;
    const groups: ModifierGroup[] = product.components.map((c, i) => {
      const qty = Math.max(1, Number(c.quantity) || 1);
      return {
        key: newKey("g"),
        name: c.label?.trim() || byId.get(Number(c.options[0]))?.name || `Parte ${i + 1}`,
        min: qty,
        included: qty,
        extraPrice: 0,
        max: qty,
        options: c.options.map((id) => ({ key: newKey("o"), name: byId.get(Number(id))?.name || `Producto ${id}`, productId: Number(id) })),
      };
    });
    const next: Product = { ...product, modifierGroups: [...groups, ...(product.modifierGroups || [])], noOwnTicket: true };
    delete next.components;
    return next;
  });
}
