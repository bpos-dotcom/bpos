/**
 * Memoria llena al descontar una venta: el 17 nov 2026 la existencia se
 * guardaba pero el kardex y la marca de "ya descontada" no, y las mismas
 * ventas se volvían a descontar sin registro (la carne bajó 114 piezas).
 * Ahora o se guarda todo o nada, y si el kardex ya trae la venta no se repite.
 *   npx tsx scripts/test-inventario-memoria-llena.ts
 */
export {};

const store = new Map<string, string>();
/** Llaves que fallan al guardar como con la memoria llena */
const full = new Set<string>();
const g = globalThis as unknown as { window: unknown; localStorage: unknown; CustomEvent: unknown; Event: unknown };
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    if (full.has(k)) throw new Error("Failed to execute 'setItem' on 'Storage': exceeded the quota");
    store.set(k, String(v));
  },
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
  const set = (k: string, v: unknown) => store.set(k, JSON.stringify(v));
  const stock = () => (JSON.parse(store.get("bpos_inventory") || "[]") as { id: number; stock: number }[]).find((i) => i.id === 2)?.stock;
  const kardex = () => JSON.parse(store.get("bpos_inventory_kardex") || "[]") as { orderId?: unknown }[];

  set("bpos_inventory", [{ id: 2, name: "Carne Northstar", unit: "pza", stock: 300, minimum: 0 }]);
  set("bpos_products", [{ id: 10, name: "Hamburguesa doble", price: 120, category: "Burgers" }]);
  set("bpos_recipes", [{ productId: 10, ingredientId: 2, quantity: 2 }]);
  const sale = (id: number, platform?: string) => ({ id, createdAt: new Date().toISOString(), items: [{ id: 10, name: "Hamburguesa doble", quantity: 1 }], ...(platform ? { externalOrderKey: `${platform}:${id}`, externalPlatform: platform } : {}) });

  // Kardex lleno: no se guarda nada (antes la existencia sí bajaba)
  full.add("bpos_inventory_kardex");
  const r1 = inv.applyInventoryForOrder(sale(643, "uber"));
  check("kardex lleno: avisa que no se pudo", !r1.success, r1);
  check("kardex lleno: la existencia NO baja", stock() === 300, stock());
  // Se reintenta varias veces mientras sigue llena: nunca baja
  inv.applyInventoryForOrder(sale(643, "uber"));
  inv.applyInventoryForOrder(sale(643, "uber"));
  check("reintentos con memoria llena: sigue igual", stock() === 300, stock());

  // Hay espacio otra vez: descuenta una sola vez
  full.clear();
  inv.applyInventoryForOrder(sale(643, "uber"));
  inv.applyInventoryForOrder(sale(643, "uber"));
  check("con espacio: descuenta 2 una sola vez", stock() === 298, stock());

  // La marca de "ya descontada" falla después de escribir el kardex: se regresa el kardex
  full.add("bpos_inventory_applied_sales");
  const before = kardex().length;
  inv.applyInventoryForOrder(sale(700));
  check("marca llena: existencia igual", stock() === 298, stock());
  check("marca llena: el kardex se regresa", kardex().length === before, kardex().length);

  // La existencia falla al final: kardex y marca se regresan
  full.clear();
  full.add("bpos_inventory");
  inv.applyInventoryForOrder(sale(701));
  check("existencia llena: kardex sin la venta", !kardex().some((m) => m.orderId === 701));
  check("existencia llena: venta sigue pendiente", !inv.inventoryWasApplied(sale(701)));
  full.clear();

  // Kardex con la venta pero sin la marca (versión anterior): no se repite
  set("bpos_inventory_kardex", [...kardex(), { id: "mov-x", ingredientId: 2, type: "Venta plataforma", quantity: 2, orderId: 644, externalOrderKey: "didi:644", reason: "Pedido didi:644", createdAt: new Date().toISOString() }]);
  inv.applyInventoryForOrder(sale(644, "didi"));
  check("kardex ya trae la venta: no descuenta otra vez", stock() === 298, stock());
  set("bpos_inventory_kardex", [...kardex(), { id: "mov-y", ingredientId: 2, type: "Venta POS", quantity: 2, orderId: 645, reason: "Venta #645", createdAt: new Date().toISOString() }]);
  inv.applyInventoryForOrder(sale(645));
  check("venta POS en el kardex: no descuenta otra vez", stock() === 298, stock());
  // Una corrección no cuenta como descuento de la venta
  set("bpos_inventory_kardex", [...kardex(), { id: "mov-z", ingredientId: 2, type: "Venta POS", quantity: 2, orderId: 646, reason: "Corrección de la venta #646: x", createdAt: new Date().toISOString() }]);
  inv.applyInventoryForOrder(sale(646));
  check("solo una corrección en el kardex: sí descuenta", stock() === 296, stock());

  // Ajuste (compra) con la memoria llena: ni sube la existencia ni queda a medias
  full.add("bpos_inventory_kardex");
  let threw = false;
  try {
    inv.adjustInventory({ ingredientId: 2, quantity: 180, adjustmentType: "Ajuste positivo", reason: "C-000099 · Carnicería" });
  } catch {
    threw = true;
  }
  check("compra con memoria llena: avisa", threw);
  check("compra con memoria llena: existencia igual", stock() === 296, stock());
  full.clear();
  inv.adjustInventory({ ingredientId: 2, quantity: 180, adjustmentType: "Ajuste positivo", reason: "C-000099 · Carnicería" });
  check("compra con espacio: sube 180", stock() === 476, stock());

  console.log(`\n${ok} bien, ${bad} mal`);
  if (bad) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
