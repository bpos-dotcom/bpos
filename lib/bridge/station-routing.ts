import type { KitchenStation } from "@/data/products";
import type { OrderInterpretation } from "@/lib/bridge/interpret-order";
import { getBusinessSettings } from "@/lib/business-settings";

/**
 * ¿A qué estaciones va cada línea de un pedido de delivery?
 *
 * - Producto del POS → su estación (Parrilla, Freidora, Barra, Cocina).
 * - Producto con opciones enlazadas (combo) → la estación de cada producto
 *   enlazado, y la suya salvo que sea un combo sin comanda propia.
 * - Ingrediente o grupo (ej. "Combo especial" = carne + papas) → la estación
 *   de los productos que usan ese ingrediente en su receta.
 * - Línea sin equivalencia o con error → la estación de respaldo
 *   (Configuración → Punto de venta), para que nadie se quede sin papel.
 * - Líneas ignoradas no van a ninguna estación.
 */
export type LineRouting = {
  stations: Set<KitchenStation>;
  /** Solo las estaciones que vienen de productos (una opción como "Coca" sí lleva su estación; un aderezo, no) */
  productStations: Set<KitchenStation>;
  ignored: boolean;
  pending: boolean;
  /** Combo: sus partes (por pieza), para que cada comanda lleve solo lo suyo */
  parts?: { name: string; quantity: number; station: KitchenStation }[];
  /** Multidestino: otras estaciones que preparan una parte, con su indicación */
  extra?: { station: KitchenStation; text: string }[];
};

type RoutingProduct = {
  id: number | string;
  name?: string;
  station?: KitchenStation | string;
  noOwnTicket?: boolean;
  extraStations?: { station: KitchenStation; text: string }[];
  modifierGroups?: { name: string; min: number; included: number; options: { productId?: number }[] }[];
};

export function stationsByLine(
  interpretation: OrderInterpretation | undefined,
  products: RoutingProduct[],
  recipes: { productId: number; ingredientId: number }[]
): Map<number, LineRouting> {
  const byLine = new Map<number, LineRouting>();
  if (!interpretation) return byLine;
  const fallback = getBusinessSettings().fallbackStation;

  const productStation = new Map(products.map((p) => [String(p.id), (p.station || "Cocina") as KitchenStation]));
  // Partes de un producto: un renglón por cada grupo con productos enlazados
  // (con varias opciones va con el nombre del grupo, "Refresco"; el sabor viene en el ticket)
  const linkedParts = (product: RoutingProduct | undefined) =>
    (product?.modifierGroups || []).flatMap((g) => {
      const first = g.options.find((o) => o.productId);
      if (!first?.productId) return [];
      const linked = products.find((x) => String(x.id) === String(first.productId));
      return [
        {
          name: g.options.length > 1 ? g.name : linked?.name || g.name,
          quantity: Math.max(1, Number(g.min) || Number(g.included) || 1),
          station: productStation.get(String(first.productId)) || ("Cocina" as KitchenStation),
        },
      ];
    });

  // Estación más usada por los productos que llevan cada ingrediente
  const ingredientStation = new Map<string, KitchenStation>();
  const counts = new Map<string, Map<KitchenStation, number>>();
  for (const r of recipes) {
    const station = productStation.get(String(r.productId));
    if (!station) continue;
    const byStation = counts.get(String(r.ingredientId)) || new Map<KitchenStation, number>();
    byStation.set(station, (byStation.get(station) || 0) + 1);
    counts.set(String(r.ingredientId), byStation);
  }
  counts.forEach((byStation, ingredientId) => {
    const best = [...byStation.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) ingredientStation.set(ingredientId, best[0]);
  });
  const forIngredient = (id: string) => ingredientStation.get(String(id)) || fallback;

  const line = (index: number) => {
    const existing = byLine.get(index);
    if (existing) return existing;
    const created: LineRouting = { stations: new Set(), productStations: new Set(), ignored: false, pending: false };
    byLine.set(index, created);
    return created;
  };

  interpretation.products.forEach((p) => {
    const l = line(p.sourceIndex);
    const product = products.find((x) => String(x.id) === String(p.productId));
    // Partes por estación solo con equivalencia compuesta (interpretaciones
    // viejas sin la marca: como antes, por tener grupos de opciones)
    const compound = p.compound === undefined ? true : p.compound;
    const parts = compound ? linkedParts(product) : [];
    const own: KitchenStation[] = !parts.length || !product?.noOwnTicket ? [productStation.get(String(p.productId)) || "Cocina"] : [];
    [...own, ...parts.map((part) => part.station)].forEach((s) => {
      l.stations.add(s);
      l.productStations.add(s);
    });
    if (parts.length) l.parts = parts;
    // Multidestino: la otra estación también recibe su parte (no cuenta como estación de opción)
    if (product?.extraStations?.length) {
      l.extra = product.extraStations;
      product.extraStations.forEach((e) => l.stations.add(e.station));
    }
  });
  interpretation.ingredients.forEach((i) => line(i.sourceIndex).stations.add(forIngredient(i.ingredientId)));
  interpretation.bundles.forEach((b) => b.targets.forEach((t) => line(b.sourceIndex).stations.add(forIngredient(t.ingredientId))));
  interpretation.ignored.forEach((i) => (line(i.sourceIndex).ignored = true));
  interpretation.pending.forEach((p) => {
    const l = line(p.sourceIndex);
    l.pending = true;
    l.stations.add(fallback);
  });
  interpretation.errors.forEach((e) => {
    if (typeof e.sourceIndex === "number") line(e.sourceIndex).stations.add(fallback);
  });

  return byLine;
}

/** Todas las estaciones del pedido (para el respaldo con el ticket original). */
export function stationsForOrder(
  interpretation: OrderInterpretation | undefined,
  products: RoutingProduct[],
  recipes: { productId: number; ingredientId: number }[]
): KitchenStation[] {
  const fallback = getBusinessSettings().fallbackStation;
  if (!interpretation) return [fallback];
  const stations = new Set<KitchenStation>();
  stationsByLine(interpretation, products, recipes).forEach((l) => l.stations.forEach((s) => stations.add(s)));
  if (interpretation.pendingCount > 0 || interpretation.errorCount > 0) stations.add(fallback);
  return stations.size ? [...stations] : [fallback];
}
