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

const uber = { ...base, platform: "Uber Eats", orderId: "8F2A1" };
check("Uber: su código en recuadro", folioOf(bagTicketHtml(uber, settings)) === "8F2A1");
const largo = { ...base, orderId: "5764609201837364" };
check("número largo: letra más chica", bagTicketHtml(largo, settings).includes('class="folio long"'));
check("sin número: como antes", !folioOf(bagTicketHtml({ ...base, orderId: "" }, settings)));
const mostrador = { ...base, kind: "mostrador" as const, platform: "Mostrador", orderId: "57" };
check("mostrador: sin recuadro", !folioOf(bagTicketHtml(mostrador, settings)));

const out = process.argv[2];
if (out) {
  writeFileSync(`${out}/folio-58.html`, bagTicketHtml(base, settings, "", 58));
  writeFileSync(`${out}/folio-80.html`, stationTicketHtml(uber, "Freidora", settings, 80));
  writeFileSync(`${out}/folio-largo.html`, bagTicketHtml(largo, settings, "", 58));
}

console.log(`\n${ok} bien, ${bad} mal`);
if (bad) process.exit(1);
