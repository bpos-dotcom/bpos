import type { KitchenStation } from "@/data/products";
import type { OrderInterpretation } from "@/lib/bridge/interpret-order";

/**
 * ¿A qué estaciones va cada línea de un pedido de delivery?
 *
 * - Producto del POS → su estación (Parrilla, Freidora, Barra, Cocina).
 * - Combo → las estaciones de sus partes.
 * - Ingrediente o grupo (ej. "Combo especial" = carne + papas) → la estación
 *   de los productos que usan ese ingrediente en su receta.
 * - Línea sin equivalencia o con error → Cocina, para que nadie se quede
 *   sin papel.
 * - Líneas ignoradas no van a ninguna estación.
 */
export type LineRouting = {
  stations: Set<KitchenStation>;
  ignored: boolean;
  pending: boolean;
  /** Combo: sus partes (por pieza), para que cada comanda lleve solo lo suyo */
  parts?: { name: string; quantity: number; station: KitchenStation }[];
};

type RoutingProduct = {
  id: number | string;
  name?: string;
  station?: KitchenStation | string;
  components?: { label?: string; quantity?: number; options: number[] }[];
};

export function stationsByLine(
  interpretation: OrderInterpretation | undefined,
  products: RoutingProduct[],
  recipes: { productId: number; ingredientId: number }[]
): Map<number, LineRouting> {
  const byLine = new Map<number, LineRouting>();
  if (!interpretation) return byLine;

  const productStation = new Map(products.map((p) => [String(p.id), (p.station || "Cocina") as KitchenStation]));
  // Combo: estaciones de sus partes (la primera opción de cada una)
  const productStations = (id: string): KitchenStation[] => {
    const product = products.find((p) => String(p.id) === id);
    if (!product?.components?.length) return [productStation.get(id) || "Cocina"];
    return product.components.map((c) => productStation.get(String(c.options[0])) || "Cocina");
  };

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
  const forIngredient = (id: string) => ingredientStation.get(String(id)) || "Cocina";

  const line = (index: number) => {
    const existing = byLine.get(index);
    if (existing) return existing;
    const created: LineRouting = { stations: new Set(), ignored: false, pending: false };
    byLine.set(index, created);
    return created;
  };

  interpretation.products.forEach((p) => {
    const l = line(p.sourceIndex);
    productStations(String(p.productId)).forEach((s) => l.stations.add(s));
    const combo = products.find((x) => String(x.id) === String(p.productId));
    if (combo?.components?.length) {
      // Parte a elegir: va con su nombre corto ("Refresco"); el sabor viene en las opciones del ticket
      l.parts = combo.components.map((c) => {
        const first = products.find((x) => String(x.id) === String(c.options[0]));
        return {
          name: c.options.length > 1 ? c.label || first?.name || "Parte" : first?.name || c.label || "Parte",
          quantity: c.quantity || 1,
          station: productStation.get(String(c.options[0])) || "Cocina",
        };
      });
    }
  });
  interpretation.ingredients.forEach((i) => line(i.sourceIndex).stations.add(forIngredient(i.ingredientId)));
  interpretation.bundles.forEach((b) => b.targets.forEach((t) => line(b.sourceIndex).stations.add(forIngredient(t.ingredientId))));
  interpretation.ignored.forEach((i) => (line(i.sourceIndex).ignored = true));
  interpretation.pending.forEach((p) => {
    const l = line(p.sourceIndex);
    l.pending = true;
    l.stations.add("Cocina");
  });
  interpretation.errors.forEach((e) => {
    if (typeof e.sourceIndex === "number") line(e.sourceIndex).stations.add("Cocina");
  });

  return byLine;
}

/** Todas las estaciones del pedido (para el respaldo con el ticket original). */
export function stationsForOrder(
  interpretation: OrderInterpretation | undefined,
  products: RoutingProduct[],
  recipes: { productId: number; ingredientId: number }[]
): KitchenStation[] {
  if (!interpretation) return ["Cocina"];
  const stations = new Set<KitchenStation>();
  stationsByLine(interpretation, products, recipes).forEach((l) => l.stations.forEach((s) => stations.add(s)));
  if (interpretation.pendingCount > 0 || interpretation.errorCount > 0) stations.add("Cocina");
  return stations.size ? [...stations] : ["Cocina"];
}
