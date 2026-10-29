import type { KitchenStation } from "@/data/products";
import type { OrderInterpretation } from "@/lib/bridge/interpret-order";

/**
 * ¿A qué estaciones va cada línea de un pedido de delivery?
 *
 * - Producto del POS → su estación (Parrilla, Freidora, Barra, Cocina).
 * - Ingrediente o grupo (ej. "Combo especial" = carne + papas) → la estación
 *   de los productos que usan ese ingrediente en su receta.
 * - Línea sin equivalencia o con error → Cocina, para que nadie se quede
 *   sin papel.
 * - Líneas ignoradas no van a ninguna estación.
 */
export type LineRouting = { stations: Set<KitchenStation>; ignored: boolean; pending: boolean };

export function stationsByLine(
  interpretation: OrderInterpretation | undefined,
  products: { id: number | string; station?: KitchenStation | string }[],
  recipes: { productId: number; ingredientId: number }[]
): Map<number, LineRouting> {
  const byLine = new Map<number, LineRouting>();
  if (!interpretation) return byLine;

  const productStation = new Map(products.map((p) => [String(p.id), (p.station || "Cocina") as KitchenStation]));

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

  interpretation.products.forEach((p) => line(p.sourceIndex).stations.add(productStation.get(String(p.productId)) || "Cocina"));
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
  products: { id: number | string; station?: KitchenStation | string }[],
  recipes: { productId: number; ingredientId: number }[]
): KitchenStation[] {
  if (!interpretation) return ["Cocina"];
  const stations = new Set<KitchenStation>();
  stationsByLine(interpretation, products, recipes).forEach((l) => l.stations.forEach((s) => stations.add(s)));
  if (interpretation.pendingCount > 0 || interpretation.errorCount > 0) stations.add("Cocina");
  return stations.size ? [...stations] : ["Cocina"];
}
