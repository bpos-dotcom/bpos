/**
 * Prueba de modificadores (opciones para elegir): obligatorios, máximo,
 * precio extra, inventario, comandas y combos con opciones en sus partes.
 *   npx tsx scripts/test-modificadores.ts
 */
import type { ModifierGroup, Product } from "@/data/products";
import { extrasPrice, itemConsumption, kitchenItems, lineIdFor, modifierProblem, needsChoices, resolveParts, soldModifiers, type SoldModifier } from "@/lib/compound";
import { saleTicket } from "@/lib/bridge/sale-tickets";
import { bagTicketHtml, stationTicketHtml } from "@/lib/bridge/ticket-html";
import { getBusinessSettings } from "@/lib/business-settings";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

const ranch: ModifierGroup = {
  key: "ranch",
  name: "Aderezo ranch",
  min: 1,
  max: 1,
  options: [
    { key: "si", name: "Sí", price: 0, ingredientId: 200, quantity: 30 },
    { key: "no", name: "No, gracias", price: 0 },
    { key: "aparte", name: "Ranch aparte", price: 15, ingredientId: 200, quantity: 60 },
  ],
};
const salsas: ModifierGroup = {
  key: "salsas",
  name: "Salsas",
  min: 0,
  max: 2,
  options: [
    { key: "bbq", name: "BBQ", price: 0, ingredientId: 201, quantity: 20 },
    { key: "bufalo", name: "Búfalo", price: 0, ingredientId: 202, quantity: 20 },
    { key: "mango", name: "Mango habanero", price: 0 },
  ],
};
const products: Product[] = [
  { id: 1, name: "Boneless Individuales", category: "Boneless", price: 129, emoji: "🍗", station: "Freidora", modifierGroups: [ranch, salsas] },
  { id: 2, name: "Coca-Cola", category: "Bebidas", price: 30, emoji: "🥤", station: "Barra" },
  {
    id: 10,
    name: "Combo Boneless",
    category: "Combos",
    price: 169,
    emoji: "🍱",
    station: "Cocina",
    components: [
      { key: "b", label: "Boneless", quantity: 1, options: [1] },
      { key: "r", label: "Refresco", quantity: 1, options: [2] },
    ],
  },
];
const boneless = products[0];
const combo = products[2];

// Reglas de elección
check("pide elegir: producto con opciones", needsChoices(boneless, products));
check("pide elegir: combo cuya parte tiene opciones", needsChoices(combo, products));
check("ranch obligatorio sin elegir → aviso", modifierProblem(boneless.modifierGroups, {}) !== "");
check("máximo 2 salsas", modifierProblem(boneless.modifierGroups, { ranch: ["no"], salsas: ["bbq", "bufalo", "mango"] }).includes("máximo 2"));
check("ranch elegido y 2 salsas → bien", modifierProblem(boneless.modifierGroups, { ranch: ["aparte"], salsas: ["bbq", "bufalo"] }) === "");

// Lo vendido
const mods = soldModifiers(boneless.modifierGroups, { ranch: ["aparte"], salsas: ["bbq", "bufalo"] });
check("opciones vendidas", mods.map((m) => `${m.group}:${m.name}`).join(",") === "Aderezo ranch:Ranch aparte,Salsas:BBQ,Salsas:Búfalo", mods);
check("precio extra $15", extrasPrice(mods) === 15);
check("otra elección = otro renglón", lineIdFor(1, undefined, mods) !== lineIdFor(1, undefined, soldModifiers(boneless.modifierGroups, { ranch: ["no"] })));

// Inventario: 2 boneless con ranch aparte (60 ml) + BBQ + Búfalo
const used = itemConsumption({ id: 1, quantity: 2, modifiers: mods }, () => []);
check("inventario: 120 ml de ranch", used.get(200) === 120, [...used]);
check("inventario: 40 g de BBQ y 40 g de búfalo", used.get(201) === 40 && used.get(202) === 40);
const sinRanch = itemConsumption({ id: 1, quantity: 1, modifiers: soldModifiers(boneless.modifierGroups, { ranch: ["no"] }) }, () => []);
check("inventario: 'No, gracias' no descuenta", !sinRanch.has(200));

// Tickets: el renglón vale 129+15=144; el ticket muestra $129 y el ranch +$15 aparte
const settings = { ...getBusinessSettings(), ticketLogo: "" };
const sale = { id: 1, createdAt: new Date().toISOString(), items: [{ name: "Boneless Individuales", price: 144, quantity: 1, station: "Freidora", modifiers: mods }], total: 144 };
const t = saleTicket(sale);
check("ticket: producto a $129 + opción $15", t.items[0].price === 129 && t.items[0].choices.find((c) => c.name === "Ranch aparte")?.price === 15, t.items[0]);
const freidora = stationTicketHtml(t, "Freidora", settings, 58);
check("comanda Freidora: ranch aparte y salsas", freidora.includes("Ranch aparte") && freidora.includes("BBQ") && freidora.includes("Búfalo"));
const cliente = bagTicketHtml(t, settings, "", 58);
check("ticket cliente: $129.00, $15.00 y total $144.00", cliente.includes("$129.00") && cliente.includes("$15.00") && cliente.includes("$144.00"));

// Combo con opciones en su parte
const parts = resolveParts(combo, products, {}, { b: soldModifiers(boneless.modifierGroups, { ranch: ["aparte"] }) });
check("combo: la parte boneless lleva su ranch", parts[0].modifiers?.[0]?.name === "Ranch aparte", parts);
check("combo: cobra extra por la opción de la parte", extrasPrice(undefined, parts) === 15);
const comboUsed = itemConsumption({ id: 10, quantity: 1, parts }, () => []);
check("combo: descuenta el ranch de la parte", comboUsed.get(200) === 60);
const kds = kitchenItems([{ id: 10, name: "Combo Boneless", quantity: 1, station: "Cocina", parts, modifiers: undefined as SoldModifier[] | undefined }]);
check("KDS: la parte boneless muestra su ranch", kds[0].modifiers?.[0]?.name === "Ranch aparte" && !kds[1].modifiers);
const comboTicket = saleTicket({ id: 2, createdAt: new Date().toISOString(), items: [{ name: "Combo Boneless", price: 184, quantity: 1, station: "Cocina", parts }], total: 184 });
check("ticket combo: precio base $169", comboTicket.items[0].price === 169, comboTicket.items[0].price);
const freidoraCombo = stationTicketHtml(comboTicket, "Freidora", settings, 58);
check("comanda Freidora del combo: boneless con ranch aparte, sin refresco", freidoraCombo.includes("Ranch aparte") && !freidoraCombo.includes("Coca-Cola"));

console.log(`\n${ok} bien, ${bad} mal`);
process.exit(bad ? 1 : 0);
