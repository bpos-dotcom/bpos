/**
 * Prueba de devolver inventario: cancelar (regresar o merma), corregir los
 * productos de una venta (equivalencia mal hecha) y que el DiDi #16 de hoy
 * sí descuente aunque ayer hubo otro DiDi #16.
 *   npx tsx scripts/test-devolver-inventario.ts
 */

// localStorage del navegador para las funciones de B-POS
const store = new Map<string, string>();
const g = globalThis as unknown as { window: unknown; localStorage: unknown; CustomEvent: unknown; Event: unknown };
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};
g.window = { dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined };
g.CustomEvent = class {
  constructor(public type: string, public init?: unknown) {}
};
g.Event = class {
  constructor(public type: string) {}
};

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

async function main() {
  const inv = await import("../lib/inventory");
  const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v));
  const stock = (id: number) => (JSON.parse(localStorage.getItem("bpos_inventory") || "[]") as { id: number; stock: number }[]).find((i) => i.id === id)?.stock;

  set("bpos_inventory", [
    { id: 1, name: "Carne", unit: "pza", stock: 100, minimum: 0 },
    { id: 2, name: "Pan", unit: "pza", stock: 100, minimum: 0 },
    { id: 3, name: "Pollo", unit: "pza", stock: 100, minimum: 0 },
    { id: 9, name: "Bolsa", unit: "pza", stock: 100, minimum: 0 },
  ]);
  set("bpos_products", [
    { id: 10, name: "Hamburguesa", price: 100, category: "Burgers", packaging: [{ ingredientId: 9, quantity: 1 }] },
    { id: 11, name: "Boneless", price: 120, category: "Pollo" },
  ]);
  set("bpos_recipes", [
    { productId: 10, ingredientId: 1, quantity: 2 },
    { productId: 10, ingredientId: 2, quantity: 1 },
    { productId: 11, ingredientId: 3, quantity: 3 },
  ]);
  set("bpos_ingredient_cost_history", [{ ingredientId: 1, purchasedAt: "2026-11-01T00:00:00Z", unitCost: 20 }]);

  // 1) Venta POS cancelada sin preparar: regresa todo
  const pos = { id: 500, createdAt: new Date().toISOString(), items: [{ id: 10, name: "Hamburguesa", quantity: 2 }] };
  inv.applyInventoryForOrder(pos);
  check("venta descuenta carne 4", stock(1) === 96, stock(1));
  check("venta descuenta bolsa 2", stock(9) === 98, stock(9));
  inv.revertInventoryForOrder(pos, "regresar", "cliente se fue");
  check("cancelar regresa carne", stock(1) === 100, stock(1));
  check("cancelar regresa bolsa", stock(9) === 100, stock(9));
  inv.revertInventoryForOrder(pos, "regresar", "otra vez");
  check("no se regresa dos veces", stock(1) === 100, stock(1));

  // 2) Cancelada ya preparada: inventario igual, merma con costo
  const pos2 = { id: 501, createdAt: new Date().toISOString(), items: [{ id: 10, name: "Hamburguesa", quantity: 1 }] };
  inv.applyInventoryForOrder(pos2);
  const r = inv.revertInventoryForOrder(pos2, "merma", "se quemó");
  check("merma: carne sigue descontada", stock(1) === 98, stock(1));
  const mermas = inv.getKardex().filter((m) => m.type === "Merma");
  check("merma anotada con costo (2 carnes × $20)", mermas.some((m) => m.ingredientId === 1 && m.cost === 40), mermas);
  check("merma total $40", r.merma === 40, r);

  // 3) Cancelar antes de que se descuente: ya no se descuenta
  const pos3 = { id: 502, createdAt: new Date().toISOString(), items: [{ id: 10, name: "Hamburguesa", quantity: 1 }] };
  inv.revertInventoryForOrder(pos3, "regresar", "rápido");
  inv.applyInventoryForOrder(pos3);
  check("cancelada antes de descontar no descuenta", stock(1) === 98, stock(1));

  // 4) Corrección de equivalencia: era Boneless, se equivaló como Hamburguesa
  const didi = { id: 600, createdAt: new Date().toISOString(), externalOrderKey: "didi:16", externalPlatform: "didi", items: [{ id: 10, name: "Hamburguesa", quantity: 1 }] };
  inv.applyInventoryForOrder(didi);
  check("didi descuenta hamburguesa", stock(1) === 96 && stock(3) === 100, [stock(1), stock(3)]);
  inv.correctInventoryForOrder({ ...didi, items: [{ id: 11, name: "Boneless", quantity: 1 }] }, "prueba");
  check("corrección regresa carne y pan", stock(1) === 98 && stock(2) === 99, [stock(1), stock(2)]);
  check("corrección descuenta pollo", stock(3) === 97, stock(3));
  inv.correctInventoryForOrder({ ...didi, items: [{ id: 11, name: "Boneless", quantity: 2 }] }, "otra corrección");
  check("segunda corrección queda en 2 boneless", stock(3) === 94 && stock(1) === 98, [stock(3), stock(1)]);

  // 5) DiDi reinicia números: el #16 de otro día sí descuenta
  const didiManana = { id: 601, createdAt: new Date().toISOString(), externalOrderKey: "didi:16", externalPlatform: "didi", items: [{ id: 11, name: "Boneless", quantity: 1 }] };
  const res = inv.applyInventoryForOrder(didiManana);
  check("el otro DiDi #16 sí descuenta", !res.duplicate && stock(3) === 91, [res.duplicate, stock(3)]);
  check("el mismo pedido no descuenta dos veces", inv.applyInventoryForOrder(didiManana).duplicate === true);

  // 6) Pedido viejo marcado con la clave antigua: no se vuelve a descontar
  const applied = JSON.parse(localStorage.getItem("bpos_inventory_applied_sales") || "[]") as string[];
  set("bpos_inventory_applied_sales", [...applied, "uber:ABC"]);
  const viejo = { id: 300, createdAt: "2026-11-03T20:00:00Z", externalOrderKey: "uber:ABC", items: [{ id: 11, name: "Boneless", quantity: 1 }] };
  check("pedido viejo con clave antigua no se descuenta otra vez", inv.applyInventoryForOrder(viejo).duplicate === true);

  // 7) Mesa con rondas: quitar platillo ya preparado
  const mesa = { id: 700, createdAt: new Date().toISOString(), items: [{ id: 10, name: "Hamburguesa", quantity: 1 }] };
  inv.applyInventoryForOrder(mesa);
  inv.applyInventoryForOrder({ id: "700-r2", items: [{ id: 11, name: "Boneless", quantity: 1 }] });
  const antes = [stock(1), stock(3)];
  inv.correctInventoryForOrder({ ...mesa, items: [{ id: 10, name: "Hamburguesa", quantity: 1 }] }, "se quitó boneless");
  check("quitar boneless de la ronda 2 regresa pollo", stock(3) === (antes[1] as number) + 3 && stock(1) === antes[0], [antes, stock(1), stock(3)]);

  console.log(`\n${ok} bien, ${bad} mal`);
  if (bad) process.exit(1);
}

void main();
