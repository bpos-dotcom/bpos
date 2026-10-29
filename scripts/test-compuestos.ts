/**
 * Prueba de productos compuestos (combos): partes, inventario, cocina,
 * comandas por estación, delivery y reportes.
 *   npx tsx scripts/test-compuestos.ts
 */
import type { Product } from "@/data/products";
import { itemConsumption, kitchenItems, resolveParts } from "@/lib/compound";
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

const products: Product[] = [
  { id: 1, name: "Hamburguesa Original", category: "Burgers", price: 99, emoji: "🍔", station: "Parrilla" },
  { id: 2, name: "Salchipapas", category: "Snacks", price: 59, emoji: "🍟", station: "Freidora" },
  { id: 3, name: "Coca-Cola", category: "Bebidas", price: 30, emoji: "🥤", station: "Barra" },
  { id: 4, name: "Manzanita", category: "Bebidas", price: 30, emoji: "🥤", station: "Barra" },
  {
    id: 10,
    name: "Combo Original",
    category: "Combos",
    price: 149,
    emoji: "🍱",
    station: "Cocina",
    components: [
      { key: "h", label: "Hamburguesa", quantity: 1, options: [1] },
      { key: "p", label: "Papas", quantity: 1, options: [2] },
      { key: "r", label: "Refresco", quantity: 1, options: [3, 4] },
    ],
  },
];
const combo = products[4];

// 1. Partes con elección
const parts = resolveParts(combo, products, { r: 4 });
check("partes del combo", parts.map((p) => p.name).join(",") === "Hamburguesa Original,Salchipapas,Manzanita", parts);
check("sin elección usa la primera opción", resolveParts(combo, products).at(-1)?.name === "Coca-Cola");

// 2. Inventario en cadena: receta propia (bolsa) + receta de cada parte
const recipes = [
  { productId: 1, ingredientId: 100, quantity: 1 }, // pan
  { productId: 1, ingredientId: 101, quantity: 150 }, // carne g
  { productId: 2, ingredientId: 102, quantity: 200 }, // papas g
  { productId: 4, ingredientId: 103, quantity: 1 }, // manzanita lata
  { productId: 10, ingredientId: 104, quantity: 1 }, // bolsa
];
const recipeOf = (id: number) => recipes.filter((r) => r.productId === id);
const used = itemConsumption({ id: 10, quantity: 2, parts }, recipeOf);
check("2 combos: 2 panes", used.get(100) === 2, [...used]);
check("2 combos: 300 g de carne", used.get(101) === 300);
check("2 combos: 400 g de papas", used.get(102) === 400);
check("2 combos: 2 manzanitas (no coca)", used.get(103) === 2);
check("2 combos: 2 bolsas (receta propia)", used.get(104) === 2);

// 3. Cocina (KDS): el combo se separa por estación
const kds = kitchenItems([{ id: 10, name: "Combo Original", quantity: 2, station: "Cocina", parts }]);
check("KDS: 3 partes", kds.length === 3);
check("KDS: hamburguesa a Parrilla x2", kds[0].station === "Parrilla" && kds[0].quantity === 2 && kds[0].fromCombo === "Combo Original", kds[0]);

// 4. Comandas: cada estación solo lo suyo; el cliente ve todo
const sale = { id: 1, localOrderNumber: 7, createdAt: new Date().toISOString(), items: [{ id: 10, name: "Combo Original", price: 149, quantity: 1, station: "Cocina", parts }], total: 149 };
const ticket = saleTicket(sale);
check("ticket: estaciones de las partes", ticket.items[0].stations.join(",") === "Parrilla,Freidora,Barra", ticket.items[0].stations);
const settings = { ...getBusinessSettings(), ticketLogo: "" };
const parrilla = stationTicketHtml(ticket, "Parrilla", settings, 58);
check("comanda Parrilla lleva la hamburguesa", parrilla.includes("Hamburguesa Original"));
check("comanda Parrilla NO lleva papas ni refresco", !parrilla.includes("Salchipapas") && !parrilla.includes("Manzanita"));
const barra = stationTicketHtml(ticket, "Barra", settings, 58);
check("comanda Barra lleva solo la Manzanita", barra.includes("Manzanita") && !barra.includes("Hamburguesa Original"));
const cliente = bagTicketHtml(ticket, settings, "", 58);
check("ticket cliente: combo con precio y todas las partes", cliente.includes("$149.00") && cliente.includes("Salchipapas") && cliente.includes("Manzanita"));

// 5. Delivery: combo equivalido → partes por estación
const interpretation = {
  products: [{ type: "product", aliasId: "a", sourceIndex: 1, externalName: "Combo Original", sourceQuantity: 2, productId: "10", productName: "Combo Original", quantity: 2 }],
  ingredients: [],
  bundles: [],
  ignored: [],
  pending: [],
  errors: [],
} as unknown as Parameters<typeof stationsByLine>[0];
const routing = stationsByLine(interpretation, products, []);
check("delivery: 3 estaciones", routing.get(1)?.stations.size === 3);
const dt = buildDeliveryTicket({ platform: "rappi", orderId: "55", rawText: "Pedido\n2x Combo Original $298\nElige tu refresco:\n1x Manzanita\nTotal $298" }, routing);
check("delivery: partes en el ticket (x2)", dt.items[0].parts?.map((p) => `${p.qty} ${p.name}`).join(",") === "2 Hamburguesa Original,2 Salchipapas,2 Refresco", dt.items[0].parts);
const barraDelivery = stationTicketHtml(dt, "Barra", settings, 58);
check("delivery: Barra ve el refresco y el sabor elegido", barraDelivery.includes("Refresco") && barraDelivery.includes("Manzanita") && !barraDelivery.includes("Salchipapas"));

// 6. Reportes: cuenta el combo y también sus partes
const report = buildReport(
  {
    orders: [sale],
    products,
    recipes,
    costHistory: [],
    kardex: [],
    purchases: [],
    shifts: [],
    inventory: [],
  } as unknown as Parameters<typeof buildReport>[0],
  { from: new Date(Date.now() - 86400000), to: new Date(Date.now() + 86400000) }
);
const row = (name: string) => report.byProduct.find((r) => r.label === name);
check("reporte: combo vendido 1 con $149", row("Combo Original")?.quantity === 1 && Math.round(row("Combo Original")!.sales) === 149, row("Combo Original"));
check("reporte: hamburguesas que salieron 1", row("Hamburguesa Original")?.quantity === 1, row("Hamburguesa Original"));
check("reporte: total vendido $149 (sin duplicar)", Math.round(report.byProduct.reduce((s, r) => s + r.sales, 0)) === 149);

console.log(`\n${ok} bien, ${bad} mal`);
process.exit(bad ? 1 : 0);
