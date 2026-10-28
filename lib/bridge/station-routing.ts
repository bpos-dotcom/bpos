import type { KitchenStation } from "@/data/products";
import type { OrderInterpretation } from "@/lib/bridge/interpret-order";

/**
 * ¿A qué estaciones va el ticket original de un pedido de delivery?
 *
 * - Producto del POS → su estación (Parrilla, Freidora, Barra, Cocina).
 * - Ingrediente o grupo (ej. "Combo especial" = carne + papas) → la estación
 *   de los productos que usan ese ingrediente en su receta.
 * - Línea sin equivalencia o con error → Cocina, para que nadie se quede
 *   sin papel.
 * - Líneas ignoradas no mandan papel a ningún lado.
 */
export function stationsForOrder(
  interpretation: OrderInterpretation | undefined,
  products: { id: number | string; station?: KitchenStation | string }[],
  recipes: { productId: number; ingredientId: number }[]
): KitchenStation[] {
  const stations = new Set<KitchenStation>();
  if (!interpretation) return ["Cocina"];

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

  interpretation.products.forEach((p) => stations.add(productStation.get(String(p.productId)) || "Cocina"));
  interpretation.ingredients.forEach((i) => stations.add(forIngredient(i.ingredientId)));
  interpretation.bundles.forEach((b) => b.targets.forEach((t) => stations.add(forIngredient(t.ingredientId))));
  if (interpretation.pendingCount > 0 || interpretation.errorCount > 0) stations.add("Cocina");

  return stations.size ? [...stations] : ["Cocina"];
}
