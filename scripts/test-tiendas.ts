/**
 * B-POS para tiendas y ferreterías: tipo de negocio, artículos con código
 * de barras, existencias 1 a 1, granel, mayoreo, importar de Excel, fiado,
 * pedido sugerido y el lector de código de barras.
 *   npx tsx scripts/test-tiendas.ts
 */
export {};

const store = new Map<string, string>();
const localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};
const g = globalThis as unknown as Record<string, unknown>;
g.localStorage = localStorage;
g.window = { localStorage, setInterval: () => 0, clearInterval: () => undefined, dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined };
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
  const bt = await import("../lib/business-type");
  const nav = await import("../lib/nav");
  const retail = await import("../lib/retail");
  const imp = await import("../lib/retail-import");
  const inv = await import("../lib/inventory");
  const credit = await import("../lib/customer-credit");
  const scan = await import("../lib/barcode-scanner");
  type Product = import("../data/products").Product;

  // --- Tipo de negocio y menú ---
  check("sin dato es restaurante", bt.getBusinessType() === "restaurante");
  store.set("bpos_business_settings", JSON.stringify({ businessName: "Abarrotes Lupita", businessType: "tienda" }));
  check("lee tienda", bt.getBusinessType() === "tienda" && bt.isRetail());
  check("dato raro = restaurante", bt.normalizeBusinessType("bar") === "restaurante");
  check("tienda esconde cocina y mesas", bt.hiddenForType("/cocina", "tienda") && bt.hiddenForType("/configuracion/mesas", "tienda") && bt.hiddenForType("/kds/abc", "tienda"));
  check("tienda conserva inventario y compras", !bt.hiddenForType("/inventario", "tienda") && !bt.hiddenForType("/compras", "tienda") && !bt.hiddenForType("/productividad", "tienda"));
  check("restaurante no ve fiado ni pedido sugerido", bt.hiddenForType("/caja/fiado", "restaurante") && bt.hiddenForType("/inventario/pedido", "restaurante"));
  check("tienda sí ve fiado", !bt.hiddenForType("/caja/fiado", "tienda"));
  const admin = { id: 1, name: "Dueña", role: "Admin" as const };
  const tiendaNav = nav.visibleNav(admin, null, "tienda");
  const restNav = nav.visibleNav(admin, null, "restaurante");
  const hrefs = (groups: typeof tiendaNav) => groups.flatMap((gr) => gr.tabs.map((t) => t.href));
  check("menú de tienda sin Cocina KDS ni Bridge", !hrefs(tiendaNav).includes("/cocina") && !hrefs(tiendaNav).includes("/bridge"));
  check("menú de tienda con Fiado y Pedido sugerido", hrefs(tiendaNav).includes("/caja/fiado") && hrefs(tiendaNav).includes("/inventario/pedido"));
  check("en la tienda Productos se llama Artículos", tiendaNav.some((gr) => gr.tabs.some((t) => t.href === "/configuracion/productos" && t.label === "Artículos")));
  check("menú de restaurante igual que antes", hrefs(restNav).includes("/cocina") && !hrefs(restNav).includes("/caja/fiado"));

  // --- Granel, mayoreo, código de barras ---
  const jitomate: Product = { id: 10, name: "Jitomate", category: "Frutas y verduras", price: 32, emoji: "🍅", station: "Cocina", sellBy: "granel", unit: "kg" };
  check("granel: 250 g = 0.25 kg", retail.bulkQuantity(jitomate, { amount: 250, mode: "chica" }) === 0.25);
  check("granel: $20 de jitomate = 0.625 kg", retail.bulkQuantity(jitomate, { amount: 20, mode: "dinero" }) === 0.625);
  check("granel: 1.5 kg", retail.bulkQuantity(jitomate, { amount: 1.5, mode: "unidad" }) === 1.5);
  const cable: Product = { id: 11, name: "Cable calibre 12", category: "Eléctrico", price: 14, emoji: "🔌", station: "Cocina", sellBy: "granel", unit: "m" };
  check("metros: 150 cm = 1.5 m", retail.bulkQuantity(cable, { amount: 150, mode: "chica" }) === 1.5);
  check("cero no agrega", retail.bulkQuantity(jitomate, { amount: 0, mode: "unidad" }) === 0);
  check("es granel", retail.isBulk(jitomate) && !retail.isBulk({ sellBy: "granel", unit: "pza" }));
  check("formato", retail.formatQty(0.25, "kg") === "0.25 kg" && retail.formatQty(3, "pza") === "3 pza");
  const coca: Product = { id: 12, name: "Coca-Cola 600 ml", category: "Bebidas", price: 20, emoji: "🥤", station: "Cocina", sellBy: "pieza", unit: "pza", barcode: "7501055300075", extraBarcodes: ["7501055300099"], wholesale: { minQty: 12, price: 17 }, cost: 13 };
  check("mayoreo desde 12", retail.unitPriceFor(coca, 11) === 20 && retail.unitPriceFor(coca, 12) === 17);
  check("ganancia", retail.margin(coca)?.profit === 7 && retail.margin(coca)?.percent === 35);
  check("busca por código", retail.findByBarcode([jitomate, coca], " 7501055300075 ")?.id === 12);
  check("busca por código extra", retail.findByBarcode([coca], "7501055300099")?.id === 12);
  check("código que no existe", retail.findByBarcode([coca], "123") === undefined);
  check("código repetido se detecta", retail.duplicateCode([coca], { id: 99, barcode: "7501055300099" })?.product.id === 12);
  check("el mismo artículo no es repetido", retail.duplicateCode([coca], coca) === null);

  // --- Existencias 1 a 1 con el motor de inventario ---
  const { products: synced, stockChanges } = retail.syncStockItems([coca, jitomate], new Map([[12, { stock: 24, minimum: 6 }], [10, { stock: 5 }]]));
  const cocaS = synced.find((p) => p.id === 12)!;
  const jitoS = synced.find((p) => p.id === 10)!;
  const ingredients = () => JSON.parse(store.get("bpos_inventory") || "[]") as { id: number; name: string; unit: string; stock: number; minimum: number; productId?: number }[];
  const recipes = () => JSON.parse(store.get("bpos_recipes") || "[]") as { productId: number; ingredientId: number; quantity: number }[];
  check("crea la existencia de cada artículo", Boolean(cocaS.stockItemId && jitoS.stockItemId) && ingredients().length === 2);
  check("con nombre, unidad y mínimo", ingredients().some((i) => i.id === cocaS.stockItemId && i.name === "Coca-Cola 600 ml" && i.unit === "pza" && i.stock === 24 && i.minimum === 6));
  check("granel en kg", ingredients().some((i) => i.id === jitoS.stockItemId && i.unit === "kg" && i.stock === 5));
  check("receta 1 a 1", recipes().filter((r) => r.productId === 12).length === 1 && recipes().find((r) => r.productId === 12)?.quantity === 1);
  check("avisa el cambio de existencia para el kardex", stockChanges.length === 2);
  store.set("bpos_products", JSON.stringify(synced));
  const again = retail.syncStockItems(synced);
  check("volver a guardar no duplica", ingredients().length === 2 && recipes().length === 2 && again.stockChanges.length === 0);
  const renamed = retail.syncStockItems(synced.map((p) => (p.id === 12 ? { ...p, name: "Coca-Cola 600" } : p)));
  check("renombrar renombra su existencia", ingredients().some((i) => i.id === cocaS.stockItemId && i.name === "Coca-Cola 600"));
  store.set("bpos_products", JSON.stringify(renamed.products));
  const oldRestaurant: Product = { id: 50, name: "Hamburguesa", category: "Burgers", price: 99, emoji: "🍔", station: "Parrilla" };
  store.set("bpos_recipes", JSON.stringify([...recipes(), { productId: 50, ingredientId: 77, quantity: 150 }]));
  retail.syncStockItems([...renamed.products, oldRestaurant]);
  check("producto de restaurante conserva su receta", recipes().some((r) => r.productId === 50 && r.ingredientId === 77));

  // Venta: 3 Coca y 0.625 kg de jitomate
  const sale = inv.applyInventoryForOrder({ id: 1, items: [{ id: 12, quantity: 3 }, { id: 10, quantity: 0.625 }] });
  check("la venta descuenta", sale.success && ingredients().find((i) => i.id === cocaS.stockItemId)?.stock === 21 && ingredients().find((i) => i.id === jitoS.stockItemId)?.stock === 4.375, sale);
  check("existencia de un artículo", retail.stockOf(cocaS)?.stock === 21);

  // Compra: actualiza costo y proveedor
  store.set("bpos_products", JSON.stringify(renamed.products.map((p) => (p.id === 10 ? { ...p, supplier: undefined } : p))));
  retail.applyPurchaseToArticles([{ ingredientId: jitoS.stockItemId!, inventoryQuantity: 10, lineTotal: 220 }], "Central de abastos");
  const afterBuy = (JSON.parse(store.get("bpos_products") || "[]") as Product[]).find((p) => p.id === 10);
  check("la compra pone costo y proveedor", afterBuy?.cost === 22 && afterBuy.supplier === "Central de abastos", afterBuy);

  // --- Pedido sugerido ---
  const now = Date.parse("2026-11-19T18:00:00Z");
  const kardex = [
    ...Array.from({ length: 14 }, (_, d) => ({ id: `k${d}`, ingredientId: cocaS.stockItemId!, ingredientName: "Coca", unit: "pza" as const, type: "Venta POS" as const, quantity: 4, previousStock: 0, finalStock: 0, createdAt: new Date(now - d * 86_400_000).toISOString() })),
    { id: "viejo", ingredientId: cocaS.stockItemId!, ingredientName: "Coca", unit: "pza" as const, type: "Venta POS" as const, quantity: 500, previousStock: 0, finalStock: 0, createdAt: new Date(now - 40 * 86_400_000).toISOString() },
  ];
  const products = JSON.parse(store.get("bpos_products") || "[]") as Product[];
  const groups = retail.suggestedOrder(products, { days: 14, coverDays: 7, now, kardex, ingredients: ingredients() as never });
  const cocaLine = groups.flatMap(([, l]) => l).find((l) => l.product.id === 12);
  // vende 4 al día → 7 días = 28 + mínimo 6 = 34 − hay 21 = 13
  check("pedido sugerido: 13 Coca", cocaLine?.quantity === 13 && cocaLine.soldPerDay === 4, cocaLine);
  check("no cuenta ventas de hace 40 días", (cocaLine?.soldPerDay || 0) < 10);
  const text = retail.suggestedOrderText("Abarrotes Lupita", "Coca-Cola FEMSA", cocaLine ? [cocaLine] : []);
  check("texto para WhatsApp", text.includes("Coca-Cola FEMSA") && text.includes("13 pza"));

  // --- Importar de Excel ---
  const rows = [
    ["Código", "Nombre", "Precio", "Costo", "Categoría", "Existencia", "Mínimo", "Unidad", "Proveedor"],
    ["7501055300075", "Coca-Cola 600 ml", "21", "", "", "", "", "", ""],
    ["", "Azúcar", "28.5", "22", "Abarrotes", "15", "3", "kg", "Zucarmex"],
    ["", "", "", "", "", "", "", "", ""],
    ["", "Sin precio", "", "", "", "", "", "", ""],
    ["7501000000001", "Tornillo 1/4", "1.50", "0.6", "Tornillería", "500", "100", "pza", ""],
    ["7501000000001", "Tornillo 1/4", "1.50", "0.6", "Tornillería", "", "", "pza", ""],
  ];
  const plan = imp.planRetailImport(rows, products, { firstId: 1000 });
  const byName = (n: string) => plan.lines.find((l) => l.name === n);
  check("importar: actualiza por código", byName("Coca-Cola 600 ml")?.status === "cambia" && byName("Coca-Cola 600 ml")?.product?.price === 21, plan.lines);
  check("importar: nuevo a granel", byName("Azúcar")?.status === "nuevo" && byName("Azúcar")?.product?.sellBy === "granel" && byName("Azúcar")?.product?.unit === "kg" && byName("Azúcar")?.stock === 15);
  check("importar: sin precio es error", byName("Sin precio")?.status === "error");
  check("importar: renglón vacío se ignora", plan.lines.length === 5);
  check("importar: repetido en el archivo es el mismo", plan.lines.filter((l) => l.name === "Tornillo 1/4" && l.product).every((l) => l.product!.id === byName("Tornillo 1/4")!.product!.id));
  check("unidades", imp.unitFromText("Kilos")?.unit === "kg" && imp.unitFromText("mts")?.unit === "m" && imp.unitFromText("PZA")?.bulk === false && imp.unitFromText("caja")?.unit === "pza");
  check("sin columna Nombre avisa", Boolean(imp.planRetailImport([["a", "b"]], []).error));

  // --- Fiado ---
  check("cuenta por WhatsApp", credit.accountKey("Doña Mary", "+52 871 123 4567") === "8711234567");
  check("cuenta por nombre", credit.accountKey("  Doña  Mary ") === "n:dona mary");
  credit.chargeCredit({ name: "Doña Mary", phone: "8711234567", amount: 150, orderId: 7, folio: "000007" });
  credit.chargeCredit({ name: "Doña Mary", phone: "8711234567", amount: 150, orderId: 7, folio: "000007" });
  check("la misma venta no se fía dos veces", credit.balanceOf("8711234567") === 150);
  credit.chargeCredit({ name: "Doña Mary", phone: "8711234567", amount: 80.5, orderId: 8 });
  check("suma lo fiado", credit.balanceOf("8711234567") === 230.5);
  credit.payCredit({ account: "8711234567", amount: 100, method: "Efectivo" });
  check("abono baja el saldo", credit.balanceOf("8711234567") === 130.5);
  let threw = false;
  try {
    credit.payCredit({ account: "8711234567", amount: 1000, method: "Efectivo" });
  } catch {
    threw = true;
  }
  check("no se abona más de lo que debe", threw);
  credit.saveCreditSettings({ defaultLimit: 200 });
  check("límite general", credit.canCharge("8711234567", 60).ok && !credit.canCharge("8711234567", 80).ok && credit.canCharge("8711234567", 0).available === 69.5);
  credit.saveCreditSettings({ limits: { "8711234567": 0 } });
  check("límite propio 0 = sin límite", credit.canCharge("8711234567", 5000).ok);
  const reversed = credit.reverseCreditForOrder(8, "se equivocó");
  check("cancelar la venta la quita del fiado", reversed === 80.5 && credit.balanceOf("8711234567") === 50);
  check("cancelar dos veces no quita dos veces", credit.reverseCreditForOrder(8, "otra vez") === 0);
  const accs = credit.creditAccounts();
  check("lista de cuentas", accs.length === 1 && accs[0].name === "Doña Mary" && accs[0].balance === 50 && Boolean(accs[0].owingSince));
  check("recordatorio", credit.creditReminderText(accs[0], "Abarrotes Lupita").includes("$50.00") && (credit.creditReminderLink(accs[0], "Abarrotes Lupita") || "").includes("528711234567"));
  let noName = false;
  try {
    credit.chargeCredit({ name: " ", amount: 10 });
  } catch {
    noName = true;
  }
  check("para fiar hace falta el nombre", noName);

  // --- Utilidad (el Food cost de la tienda) ---
  const prof = await import("../lib/retail-profit");
  check("tienda ve Utilidad en lugar de Food cost", tiendaNav.some((gr) => gr.tabs.some((t) => t.href === "/configuracion/food-cost" && t.label === "Utilidad")) && !bt.hiddenForType("/configuracion/food-cost", "tienda"));
  check("restaurante sigue con Food cost", restNav.some((gr) => gr.tabs.some((t) => t.href === "/configuracion/food-cost" && t.label === "Food cost")));
  const varios: Product = { id: 13, name: "Varios", category: "Varios", price: 0, emoji: "🏷️", station: "Cocina", sellBy: "pieza", openPrice: true, noStock: true };
  const sinCosto: Product = { id: 14, name: "Chicle", category: "Dulces", price: 2, emoji: "🍬", station: "Cocina", sellBy: "pieza" };
  const result = prof.retailProfit(
    [coca, jitomate, varios, sinCosto],
    [
      { items: [{ id: 12, price: 17, quantity: 12 }, { id: 10, price: 32, quantity: 0.25 }] },
      { items: [{ id: 12, price: 20, quantity: 2 }, { id: 13, price: 15, quantity: 1 }, { id: 14, price: 2, quantity: 5 }], details: { discount: 4 } },
    ],
    (p) => (p.id === 10 ? 22 : p.cost ?? null)
  );
  const row = (id: number) => result.rows.find((r) => r.product.id === id)!;
  // Coca: 12×17 + 2×20 = 244 de venta, 14×13 = 182 de costo → 62
  check("utilidad con precio real (mayoreo)", row(12).sales === 244 && row(12).costOfSales === 182 && row(12).profit === 62, row(12));
  check("deja c/u y margen", row(12).unitProfit === 7 && row(12).margin === 35);
  check("granel: 0.25 kg", row(10).sold === 0.25 && row(10).sales === 8 && row(10).profit === 2.5, row(10));
  check("precio libre sin costo", row(13).profit === null && row(13).sales === 15);
  check("sin costo avisa", row(14).cost === null && result.totals.missingCost === 1 && result.totals.salesWithoutCost === 25);
  check("total: ganancia menos descuentos", result.totals.profit === 60.5 && result.totals.sales === 277, result.totals);

  // --- Precio en el menú digital (antes se llamaba a sí mismo y tumbaba la página) ---
  const fmt = (n: number) => `$${n}`;
  check("menú: precio por pieza", retail.priceWithUnit({ price: 18 }, fmt) === "$18");
  check("menú: precio a granel con unidad", retail.priceWithUnit({ price: "32", sellBy: "granel", unit: "kg" }, fmt) === "$32/kg");
  check("menú: granel en piezas sin unidad", retail.priceWithUnit({ price: 5, sellBy: "granel", unit: "pza" }, fmt) === "$5");

  // --- Lector de código de barras ---
  check("lector: teclas seguidas", scan.looksScanned([0, 10, 22, 30, 41, 55]));
  check("persona tecleando no es lector", !scan.looksScanned([0, 180, 400, 620]));
  check("muy corto no es código", !scan.looksScanned([0, 5]));

  console.log(`\n${ok} bien, ${bad} mal`);
  if (bad) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
