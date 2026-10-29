/**
 * Prueba de modificadores (opciones para elegir): incluidas gratis, cobro
 * solo de las de más, repetidas, obligatorios, tope, inventario, comandas y
 * combos con opciones en sus partes.
 *   npx tsx scripts/test-modificadores.ts
 */
import type { ModifierGroup, Product } from "@/data/products";
import { extrasPrice, itemConsumption, kitchenItems, lineIdFor, modifierProblem, modifiersText, needsChoices, resolveParts, soldModifiers, type SoldModifier } from "@/lib/compound";
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

// Ranch: obligatorio, 1 incluido, uno de más cuesta $15
const ranch: ModifierGroup = {
  key: "ranch",
  name: "Aderezo ranch",
  min: 1,
  included: 1,
  extraPrice: 15,
  max: 0,
  options: [
    { key: "si", name: "Ranch", ingredientId: 200, quantity: 30 },
    { key: "no", name: "No, gracias" },
  ],
};
// Salsas: 4 incluidas, cada extra $15, máximo 8
const salsas: ModifierGroup = {
  key: "salsas",
  name: "Salsas",
  min: 0,
  included: 4,
  extraPrice: 15,
  max: 8,
  options: [
    { key: "bbq", name: "BBQ", ingredientId: 201, quantity: 20 },
    { key: "bufalo", name: "Búfalo", ingredientId: 202, quantity: 20 },
    { key: "mango", name: "Mango habanero" },
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
check("tope de 8 salsas", modifierProblem(boneless.modifierGroups, { ranch: ["no"], salsas: Array(9).fill("bbq") }).includes("máximo 8"));
check("5 salsas sí se permiten (hay tope de 8)", modifierProblem(boneless.modifierGroups, { ranch: ["si"], salsas: ["bbq", "bbq", "bufalo", "mango", "bufalo"] }) === "");

// Dentro de lo incluido: gratis
const cuatro = soldModifiers(boneless.modifierGroups, { ranch: ["si"], salsas: ["bbq", "bbq", "bufalo", "mango"] });
check("4 salsas y 1 ranch: $0 extra", extrasPrice(cuatro) === 0, cuatro);
check("texto: doble BBQ junta", modifiersText(cuatro) === "Aderezo ranch: Ranch · Salsas: 2x BBQ, Búfalo, Mango habanero", modifiersText(cuatro));

// De más: solo se cobra lo que pasa
const seis = soldModifiers(boneless.modifierGroups, { ranch: ["si", "si"], salsas: ["bbq", "bbq", "bufalo", "mango", "bufalo", "bbq"] });
check("2 ranch (1 extra) + 6 salsas (2 extra) = $45", extrasPrice(seis) === 45, seis.filter((m) => m.extra));
check("renglones de cobro", seis.filter((m) => m.extra).map((m) => m.name).join(",") === "Aderezo ranch extra (1),Salsas extra (2)");
check("otra elección = otro renglón del carrito", lineIdFor(1, undefined, cuatro) !== lineIdFor(1, undefined, seis));
const sinCobro = soldModifiers([{ ...salsas, extraPrice: 0 }], { salsas: Array(6).fill("bbq") });
check("extras sin costo si el precio por extra es 0", extrasPrice(sinCobro) === 0 && !sinCobro.some((m) => m.extra));

// Inventario: cada elección descuenta, incluidas y extras
const used = itemConsumption({ id: 1, quantity: 2, modifiers: seis }, () => []);
check("inventario: 2 boneless × 2 ranch × 30 ml = 120 ml", used.get(200) === 120, [...used]);
check("inventario: 2 × 3 BBQ × 20 g = 120 g", used.get(201) === 120);
const noGracias = itemConsumption({ id: 1, quantity: 1, modifiers: soldModifiers(boneless.modifierGroups, { ranch: ["no"] }) }, () => []);
check("inventario: 'No, gracias' no descuenta", !noGracias.has(200));

// Tickets: renglón vale 129 + 45 = 174
const settings = { ...getBusinessSettings(), ticketLogo: "" };
const sale = { id: 1, createdAt: new Date().toISOString(), items: [{ name: "Boneless Individuales", price: 174, quantity: 1, station: "Freidora", modifiers: seis }], total: 174 };
const t = saleTicket(sale);
check("ticket: producto a $129", t.items[0].price === 129, t.items[0].price);
check("ticket: 3x BBQ junto", t.items[0].choices.some((c) => c.name === "BBQ" && c.qty === 3));
check("ticket: cobro de salsas extra $30", t.items[0].choices.find((c) => c.name === "Salsas extra (2)")?.price === 30);
const freidora = stationTicketHtml(t, "Freidora", settings, 58);
check("comanda Freidora: salsas y ranch", freidora.includes("BBQ") && freidora.includes("Búfalo") && freidora.includes("Ranch"));
const cliente = bagTicketHtml(t, settings, "", 58);
check("ticket cliente: $129.00, $15.00, $30.00 y total $174.00", ["$129.00", "$15.00", "$30.00", "$174.00"].every((x) => cliente.includes(x)));

// Combo con opciones en su parte
const parts = resolveParts(combo, products, {}, { b: soldModifiers(boneless.modifierGroups, { ranch: ["si"], salsas: ["bbq", "bbq", "bbq", "bbq", "mango"] }) });
check("combo: la parte boneless lleva sus opciones", modifiersText(parts[0].modifiers) === "Aderezo ranch: Ranch · Salsas: 4x BBQ, Mango habanero", modifiersText(parts[0].modifiers));
check("combo: cobra la salsa extra de la parte ($15)", extrasPrice(undefined, parts) === 15);
const kds = kitchenItems([{ id: 10, name: "Combo Boneless", quantity: 1, station: "Cocina", parts, modifiers: undefined as SoldModifier[] | undefined }]);
check("KDS: la parte boneless muestra sus opciones y el refresco no", Boolean(kds[0].modifiers?.length) && !kds[1].modifiers);
const comboTicket = saleTicket({ id: 2, createdAt: new Date().toISOString(), items: [{ name: "Combo Boneless", price: 184, quantity: 1, station: "Cocina", parts }], total: 184 });
check("ticket combo: precio base $169", comboTicket.items[0].price === 169, comboTicket.items[0].price);
const freidoraCombo = stationTicketHtml(comboTicket, "Freidora", settings, 58);
check("comanda Freidora del combo: boneless con sus salsas, sin refresco", freidoraCombo.includes("4x BBQ") && !freidoraCombo.includes("Coca-Cola"));

console.log(`\n${ok} bien, ${bad} mal`);
process.exit(bad ? 1 : 0);
