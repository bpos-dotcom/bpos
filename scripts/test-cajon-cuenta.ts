/**
 * Cajón abierto sin venta: el aviso dice qué llevaba la cuenta y se quita
 * cuando esa misma cuenta (por su ID) se cobra después, aunque le hayan
 * agregado productos y cueste más.
 *   npx tsx scripts/test-cajon-cuenta.ts
 */
import { drawerDescription, findDrawerSuspect, type Suspect } from "../lib/cash-drawer";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

const boneless = [{ quantity: 2, name: "Boneless Orden Individual" }];
const cerrado: Suspect = { id: "s1", at: Date.now(), paymentMethod: "Efectivo", total: 178, orderType: "Mostrador", key: "cuenta-a", items: boneless };

const text = drawerDescription("CAJERO", cerrado);
check("el aviso dice qué llevaba", text === "CAJERO: se abrió el cajón y el cobro de $178.00 se canceló sin venta (Mostrador). Llevaba: 2x Boneless Orden Individual.", text);
check("sin productos queda como antes", drawerDescription("CAJERO", { paymentMethod: "Efectivo", total: 50 }) === "CAJERO: se abrió el cajón y el cobro de $50.00 se canceló sin venta.");

check("se cobra la misma cuenta con 2 refrescos más ($238): es esa", findDrawerSuspect([cerrado], 238, "cuenta-a")?.id === "s1");
check("otra cuenta con el mismo total ($178): no se confunde", findDrawerSuspect([cerrado], 178, "cuenta-b") === undefined);
check("otra cuenta con otro total: no", findDrawerSuspect([cerrado], 238, "cuenta-b") === undefined);
const viejo: Suspect = { id: "s0", at: Date.now(), paymentMethod: "Efectivo", total: 120 };
check("aviso de antes (sin ID): se reconoce por el total", findDrawerSuspect([viejo, cerrado], 120, "cuenta-c")?.id === "s0");
check("sin ID al cobrar: por el total", findDrawerSuspect([cerrado], 178)?.id === "s1");
const otraVez: Suspect = { ...cerrado, id: "s2", total: 208 };
check("la misma cuenta cerrada dos veces: se toma la última", findDrawerSuspect([cerrado, otraVez], 238, "cuenta-a")?.id === "s2");
check("cuenta en espera (pedido-…) cobrada después", findDrawerSuspect([{ ...cerrado, key: "pedido-77" }], 347, "pedido-77")?.id === "s1");

console.log(`\n${ok} bien, ${bad} mal`);
if (bad) process.exit(1);
