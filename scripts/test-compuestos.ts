/**
 * Prueba de combos con opciones enlazadas a productos: venta, inventario,
 * cocina, comandas por estación, delivery, reportes, conversión de los
 * combos de la 1.10 y copia de opciones.
 *   npx tsx scripts/test-compuestos.ts
 */
import type { ModifierGroup, Product } from "@/data/products";
import { buildSelection, copyGroups, itemConsumption, kitchenItems, linkedOwner, migrateComponents, needsChoices, OWN_OPTIONS } from "@/lib/compound";
import { saleTicket } from "@/lib/bridge/sale-tickets";
import { bagTicketHtml, stationTicketHtml } from "@/lib/bridge/ticket-html";
import { stationsByLine } from "@/lib/bridge/station-routing";
import { buildDeliveryTicket } from "@/lib/bridge/delivery-ticket";
import { buildReport } from "@/lib/reports";
import { getBusinessSettings } from "@/lib/business-settings";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

const salsas: ModifierGroup = {
  key: "salsas",
  name: "Salsas",
  min: 0,
  included: 2,
  extraPrice: 15,
  max: 0,
  options: [
    { key: "bbq", name: "BBQ", ingredientId: 201, quantity: 20 },
    { key: "mango", name: "Mango habanero" },
  ],
};
const fixed = (key: string, name: string, productId: number): ModifierGroup => ({ key, name, min: 1, included: 1, extraPrice: 0, max: 1, options: [{ key: `${key}1`, name, productId }] });
const products: Product[] = [
  { id: 1, name: "Hamburguesa Original", category: "Burgers", price: 99, emoji: "🍔", station: "Parrilla" },
  { id: 2, name: "Salchipapas", category: "Snacks", price: 59, emoji: "🍟", station: "Freidora" },
  { id: 3, name: "Coca-Cola", category: "Bebidas", price: 30, emoji: "🥤", station: "Barra" },
  { id: 4, name: "Manzanita", category: "Bebidas", price: 30, emoji: "🥤", station: "Barra" },
  { id: 5, name: "Boneless Individuales", category: "Boneless", price: 129, emoji: "🍗", station: "Freidora", modifierGroups: [salsas] },
  {
    id: 10,
    name: "Combo Original",
    category: "Combos",
    price: 149,
    emoji: "🍱",
    station: "Cocina",
    noOwnTicket: true,
    modifierGroups: [
      fixed("h", "Hamburguesa", 1),
      fixed("p", "Papas", 2),
      {
        key: "r",
        name: "Refresco",
        min: 1,
        included: 1,
        extraPrice: 0,
        max: 1,
        options: [
          { key: "coca", name: "Coca-Cola", productId: 3 },
          { key: "manz", name: "Manzanita", productId: 4 },
        ],
      },
    ],
  },
  {
    id: 11,
    name: "Combo Boneless",
    category: "Combos",
    price: 169,
    emoji: "🍱",
    station: "Cocina",
    noOwnTicket: true,
    modifierGroups: [fixed("b", "Boneless", 5), fixed("r2", "Refresco", 3)],
  },
  // Producto con comanda propia y una bebida enlazada
  {
    id: 12,
    name: "Alitas con refresco",
    category: "Alitas",
    price: 139,
    emoji: "🍗",
    station: "Freidora",
    modifierGroups: [fixed("r3", "Refresco", 3)],
  },
];
const combo = products[5];

// 1. Elegir: el refresco hay que elegirlo; lo fijo viene solo
check("combo pide elegir (refresco)", needsChoices(combo, products));
check("combo boneless pide elegir (salsas de los boneless)", needsChoices(products[6], products));
check("alitas con refresco fijo no pide nada", !needsChoices(products[7], products));
const sel = buildSelection(combo, products, { [OWN_OPTIONS]: { r: ["manz"] } });
check("partes: hamburguesa, papas y manzanita", sel.parts?.map((p) => p.name).join(",") === "Hamburguesa Original,Salchipapas,Manzanita", sel.parts);
check("combo sin comanda propia", sel.ownTicket === false);

// 2. Inventario: receta de cada producto enlazado + la bolsa del combo
const recipes = [
  { productId: 1, ingredientId: 100, quantity: 1 },
  { productId: 1, ingredientId: 101, quantity: 150 },
  { productId: 2, ingredientId: 102, quantity: 200 },
  { productId: 4, ingredientId: 103, quantity: 1 },
  { productId: 10, ingredientId: 104, quantity: 1 },
];
const recipeOf = (id: number) => recipes.filter((r) => r.productId === id);
const used = itemConsumption({ id: 10, quantity: 2, parts: sel.parts }, recipeOf);
check("2 combos: 2 panes, 300 g carne, 400 g papas", used.get(100) === 2 && used.get(101) === 300 && used.get(102) === 400, [...used]);
check("2 combos: 2 manzanitas (no coca) y 2 bolsas", used.get(103) === 2 && used.get(104) === 2);

// 3. Cocina: cada producto a su estación; el combo no sale solo
const kds = kitchenItems([{ id: 10, name: "Combo Original", quantity: 2, station: "Cocina", parts: sel.parts, ownTicket: sel.ownTicket }]);
check("KDS combo: 3 renglones (sin el combo)", kds.length === 3 && !kds.some((k) => k.station === "Cocina"), kds.map((k) => k.station));
check("KDS: hamburguesa x2 en Parrilla", kds[0].station === "Parrilla" && kds[0].quantity === 2 && kds[0].fromCombo === "Combo Original");
const alitas = buildSelection(products[7], products);
const kdsAlitas = kitchenItems([{ id: 12, name: "Alitas con refresco", quantity: 1, station: "Freidora", parts: alitas.parts, ownTicket: alitas.ownTicket }]);
check("KDS alitas: Freidora (alitas) + Barra (refresco)", kdsAlitas.map((k) => k.station).join(",") === "Freidora,Barra", kdsAlitas.map((k) => k.station));

// 4. Comandas
const settings = { ...getBusinessSettings(), ticketLogo: "" };
const sale = { id: 1, createdAt: new Date().toISOString(), items: [{ id: 10, name: "Combo Original", price: 149, quantity: 1, station: "Cocina", parts: sel.parts, ownTicket: false }], total: 149 };
const ticket = saleTicket(sale);
check("ticket combo: Parrilla, Freidora y Barra (sin Cocina)", ticket.items[0].stations.join(",") === "Parrilla,Freidora,Barra", ticket.items[0].stations);
const parrilla = stationTicketHtml(ticket, "Parrilla", settings, 58);
check("comanda Parrilla: solo hamburguesa", parrilla.includes("Hamburguesa Original") && !parrilla.includes("Salchipapas") && !parrilla.includes("Manzanita"));
check("comanda Barra: solo manzanita", stationTicketHtml(ticket, "Barra", settings, 58).includes("Manzanita"));
check("ticket cliente: combo $149 con sus partes", ["$149.00", "Hamburguesa Original", "Salchipapas", "Manzanita"].every((x) => bagTicketHtml(ticket, settings, "", 58).includes(x)));
const alitasSale = { id: 3, createdAt: new Date().toISOString(), items: [{ name: "Alitas con refresco", price: 139, quantity: 1, station: "Freidora", parts: alitas.parts, ownTicket: true }], total: 139 };
const alitasTicket = saleTicket(alitasSale);
check("alitas: comanda en Freidora y en Barra", alitasTicket.items[0].stations.join(",") === "Freidora,Barra", alitasTicket.items[0].stations);

// 5. Combo boneless: las salsas de los boneless se eligen y cobran
const selB = buildSelection(products[6], products, { [linkedOwner(5)]: { salsas: ["bbq", "bbq", "mango"] } });
check("combo boneless: boneless con 3 salsas", selB.parts?.[0].modifiers?.filter((m) => !m.extra).length === 3, selB.parts);
check("combo boneless: 1 salsa extra cobrada $15", selB.parts?.[0].modifiers?.find((m) => m.extra)?.price === 15);
const usedB = itemConsumption({ id: 11, quantity: 1, parts: selB.parts }, () => []);
check("combo boneless: descuenta 40 g de BBQ", usedB.get(201) === 40);

// 6. Delivery
const interpretation = {
  products: [{ type: "product", aliasId: "a", sourceIndex: 1, externalName: "Combo Original", sourceQuantity: 2, productId: "10", productName: "Combo Original", quantity: 2 }],
  ingredients: [],
  bundles: [],
  ignored: [],
  pending: [],
  errors: [],
} as unknown as Parameters<typeof stationsByLine>[0];
const routing = stationsByLine(interpretation, products, []);
check("delivery: 3 estaciones (sin Cocina)", [...(routing.get(1)?.stations || [])].sort().join(",") === "Barra,Freidora,Parrilla", [...(routing.get(1)?.stations || [])]);
const dt = buildDeliveryTicket({ platform: "rappi", orderId: "55", rawText: "Pedido\n2x Combo Original $298\nElige tu refresco:\n1x Manzanita\nTotal $298" }, routing);
check("delivery: partes x2", dt.items[0].parts?.map((p) => `${p.qty} ${p.name}`).join(",") === "2 Hamburguesa Original,2 Salchipapas,2 Refresco", dt.items[0].parts);
check("delivery: Barra ve el refresco y el sabor", ["Refresco", "Manzanita"].every((x) => stationTicketHtml(dt, "Barra", settings, 58).includes(x)));

// 7. Reportes: combo y lo que salió dentro
const report = buildReport(
  { orders: [sale], products, recipes, costHistory: [], purchases: [], shifts: [], inventory: [], kardex: [] } as unknown as Parameters<typeof buildReport>[0],
  { from: new Date(Date.now() - 86400000), to: new Date(Date.now() + 86400000) }
);
const row = (name: string) => report.byProduct.find((r) => r.label === name);
check("reporte: combo 1 con $149", row("Combo Original")?.quantity === 1 && Math.round(row("Combo Original")!.sales) === 149, row("Combo Original"));
check("reporte: manzanitas que salieron 1", row("Manzanita")?.quantity === 1);
check("reporte: total $149 sin duplicar", Math.round(report.byProduct.reduce((s, r) => s + r.sales, 0)) === 149);

// 8. Combos de la 1.10 se convierten solos
const old: Product[] = [
  products[0],
  products[2],
  products[3],
  { id: 20, name: "Combo Viejo", category: "Combos", price: 149, emoji: "🍱", station: "Cocina", components: [{ key: "a", label: "Hamburguesa", quantity: 2, options: [1] }, { key: "b", label: "Refresco", quantity: 1, options: [3, 4] }] },
];
const migrated = migrateComponents(old)!;
const mc = migrated.find((p) => p.id === 20)!;
check("conversión: sin partes viejas y sin comanda propia", !mc.components && mc.noOwnTicket === true);
check("conversión: hamburguesa x2 fija enlazada", mc.modifierGroups?.[0].min === 2 && mc.modifierGroups?.[0].options[0].productId === 1);
check("conversión: refresco a elegir entre 2 productos", mc.modifierGroups?.[1].options.map((o) => o.productId).join(",") === "3,4");
check("conversión: lo fijo x2 se elige solo", buildSelection(mc, migrated).parts?.[0].quantity === 2);
check("conversión: no hace nada si ya no hay partes", migrateComponents(migrated) === null);

// 9. Copiar opciones: copia independiente
const copied = copyGroups([salsas], "Boneless Individuales");
check("copia: claves nuevas", copied[0].key !== salsas.key && copied[0].options[0].key !== salsas.options[0].key);
check("copia: marca de dónde vino", copied[0].copiedFrom?.productName === "Boneless Individuales" && copied[0].copiedFrom.edited === false);
copied[0].options.push({ key: "x", name: "Búfalo" });
check("copia: cambiar la copia no cambia el original", salsas.options.length === 2);

console.log(`\n${ok} bien, ${bad} mal`);
process.exit(bad ? 1 : 0);
