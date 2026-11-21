/**
 * Ticket de plataforma: el número del pedido (el que dice el repartidor de
 * DiDi/Uber) sale grande, al centro y en un recuadro, en la comanda y en el de la bolsa.
 *   npx tsx scripts/test-ticket-folio.ts [carpeta-para-guardar-html]
 */
import { writeFileSync } from "node:fs";
import { getBusinessSettings } from "../lib/business-settings";
import { bagTicketHtml, stationTicketHtml } from "../lib/bridge/ticket-html";
import type { DeliveryTicket } from "../lib/bridge/delivery-ticket";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

const base: DeliveryTicket = {
  kind: "delivery",
  platform: "DiDi Food",
  orderId: "4",
  localNumber: "123",
  customer: "YuliaCristina",
  receivedAt: "2026-11-20T23:03:00-06:00",
  items: [{ index: 0, qty: 1, name: "Boneless Individuales", price: 139, choices: [{ qty: 1, name: "Queso Amarillo", price: 0, question: "Elige el aderezo:" }], notes: [], stations: ["Freidora"], pending: false }],
  charges: [],
  total: 111,
};
const settings = getBusinessSettings(); // sin ventana: la configuración de fábrica
check("configuración de fábrica cargada", Boolean(settings?.ticketFontSize));
const folioOf = (html: string) => html.match(/<span class="folio[^"]*">([^<]*)<\/span>/)?.[1];

const bag = bagTicketHtml(base, settings);
const station = stationTicketHtml(base, "Freidora", settings);
check("bolsa: número en recuadro", folioOf(bag) === "4", folioOf(bag));
check("comanda: número en recuadro", folioOf(station) === "4", folioOf(station));
check("arriba solo la plataforma (sin '/ 4')", bag.includes(">DiDi Food</div>") && !bag.includes("DiDi Food / 4"));

const uber = { ...base, platform: "Uber Eats", orderId: "7FD5A", customer: "Daniel A." };
const uberHtml = bagTicketHtml(uber, settings);
check("Uber de fábrica: el nombre en el recuadro", folioOf(uberHtml) === "Daniel A.", folioOf(uberHtml));
check("Uber de fábrica: el código junto a Delivery", uberHtml.includes("Delivery · 7FD5A"));
check("Uber sin nombre: el código en el recuadro", folioOf(bagTicketHtml({ ...uber, customer: null }, settings)) === "7FD5A");
const largo = { ...base, orderId: "5764609201837364" };
check("número largo: letra más chica", bagTicketHtml(largo, settings).includes('class="folio long"'));
check("sin número: va el nombre del cliente", folioOf(bagTicketHtml({ ...base, orderId: "" }, settings)) === "YuliaCristina");
const mostrador = { ...base, kind: "mostrador" as const, platform: "Mostrador", orderId: "57" };
const local = bagTicketHtml(mostrador, settings);
check("local de fábrica: sin recuadro, con su folio", !folioOf(local) && local.includes("Pedido #57") && local.includes(">YuliaCristina<"));

// Configurador: cada negocio elige
const conf = (kind: string, layout: object) => ({ ...settings, ticketLayouts: { ...settings.ticketLayouts, [kind]: { ...settings.ticketLayouts[kind as "didi"], ...layout } } });
const didiNombre = bagTicketHtml(base, conf("didi", { box: "customer", beside: "number" }));
check("DiDi con nombre en recuadro", folioOf(didiNombre) === "YuliaCristina" && didiNombre.includes("Delivery · 4"));
const texto = bagTicketHtml(base, conf("didi", { top: "text", topText: "Sucursal Centro" }));
check("arriba texto propio", texto.includes(">Sucursal Centro<") && !texto.includes(">Mi negocio<"));
check("arriba nada", !bagTicketHtml(base, conf("didi", { top: "none" })).includes(">Mi negocio<"));
check("arriba nombre del negocio", bagTicketHtml(base, conf("didi", { top: "name" })).includes(">Mi negocio<"));
check("recuadro nada", !folioOf(bagTicketHtml(base, conf("didi", { box: "none" }))));
const localNum = bagTicketHtml(mostrador, conf("local", { box: "number" }));
check("local con folio en recuadro: no se repite abajo", folioOf(localNum) === "57" && !localNum.includes("Pedido #57"));
check("cambiar DiDi no cambia Uber", folioOf(bagTicketHtml(uber, conf("didi", { box: "none" }))) === "Daniel A.");
check("ajustes viejos sin configurador: como de fábrica", folioOf(bagTicketHtml(base, { ...settings, ticketLayouts: undefined as never })) === "4");

const out = process.argv[2];
if (out) {
  writeFileSync(`${out}/folio-58.html`, bagTicketHtml(base, settings, "", 58));
  writeFileSync(`${out}/folio-80.html`, stationTicketHtml(uber, "Freidora", settings, 80));
  writeFileSync(`${out}/folio-largo.html`, bagTicketHtml(largo, settings, "", 58));
}

console.log(`\n${ok} bien, ${bad} mal`);
if (bad) process.exit(1);

// Al guardar se conserva lo elegido (y lo inválido vuelve a lo de fábrica)
{
  const mem = new Map<string, string>();
  const g = globalThis as unknown as { window: unknown; localStorage: unknown; CustomEvent: unknown };
  g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  g.window = { dispatchEvent: () => true };
  g.CustomEvent = class { constructor(public type: string, public init?: unknown) {} };
  import("../lib/business-settings").then(({ saveBusinessSettings, getBusinessSettings: get }) => {
    saveBusinessSettings({ ticketLayouts: { ...settings.ticketLayouts, uber: { top: "text", topText: "Centro", box: "number", beside: "rara" as never } } });
    const u = get().ticketLayouts.uber;
    const okSave = u.top === "text" && u.topText === "Centro" && u.box === "number" && u.beside === "number";
    console.log(`${okSave ? "OK   " : "FALLA"} guardar: se conserva el configurador`);
    if (!okSave) process.exit(1);
  });
}
