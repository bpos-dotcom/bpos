/**
 * Bridge: DiDi reinicia sus números a las 00:00. El #1 de las 4 pm y el #1
 * de las 00:30 (con el turno abierto) son pedidos distintos; una reimpresión
 * el mismo día sigue siendo el mismo. Cada pedido se guarda aparte (llave de
 * repetidos) y la venta de uno no tapa la del otro.
 *   npx tsx scripts/test-bridge-turnos.ts
 */
import { baseOrderKey, isSameOrder, isSameSale, mexicoDay, mexicoStamp, orderKey, repeatKey, validKey } from "../lib/bridge/order-identity";
import { keyForIncoming } from "../lib/bridge/store";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

// Horas de México (UTC-6)
const mx = (iso: string) => Date.parse(`${iso}-06:00`);
const at4pm = mx("2026-11-21T16:00:00");
const at0030 = mx("2026-11-22T00:30:00");
const items1 = [{ name: "Hamburguesa", qty: 1 }];
const items2 = [{ name: "Boneless", qty: 2 }];

check("día en México: 4 pm del 21", mexicoDay(at4pm) === "20261121", mexicoDay(at4pm));
check("día en México: 00:30 ya es 22", mexicoDay(at0030) === "20261122", mexicoDay(at0030));
check("sello con hora", mexicoStamp(at0030) === "202611220030", mexicoStamp(at0030));

// El caso del usuario
check("DiDi #1 4 pm y #1 00:30 (otro pedido) → NO es duplicado", !isSameOrder({ platform: "didi", at: at4pm, total: 129, items: items1 }, { platform: "didi", at: at0030, total: 245, items: items2 }));
check("DiDi mismo número el mismo día → es el mismo (reimpresión)", isSameOrder({ platform: "didi", at: at4pm, total: 129 }, { platform: "didi", at: mx("2026-11-21T21:00:00"), total: 129 }));
check("DiDi reimpresión justo después de medianoche (mismo total, 10 min) → mismo", isSameOrder({ platform: "didi", at: mx("2026-11-21T23:55:00"), total: 129, items: items1 }, { platform: "didi", at: mx("2026-11-22T00:05:00"), total: 129, items: items1 }));
check("DiDi a los 10 min pasando medianoche pero con otra cosa → otro pedido", !isSameOrder({ platform: "didi", at: mx("2026-11-21T23:55:00"), total: 129, items: items1 }, { platform: "didi", at: mx("2026-11-22T00:05:00"), total: 300, items: items2 }));
check("DiDi mismo total pero 2 horas después de medianoche → otro pedido", !isSameOrder({ platform: "didi", at: mx("2026-11-21T23:00:00"), total: 129 }, { platform: "didi", at: mx("2026-11-22T01:00:00"), total: 129 }));
check("Uber mismo código en 3 h (aunque pase medianoche) → mismo", isSameOrder({ platform: "uber", at: mx("2026-11-21T22:00:00") }, { platform: "uber", at: mx("2026-11-22T01:00:00") }));
check("Uber mismo código 13 h después → otro", !isSameOrder({ platform: "uber", at: mx("2026-11-21T08:00:00") }, { platform: "uber", at: mx("2026-11-21T21:00:00") }));

// Llaves: el primero normal, el que repite número aparte
const order = { platform: "didi", orderId: "1", total: 245, items: items2 };
check("primer pedido con ese número → llave normal", keyForIncoming(order, null, at0030) === "didi|1");
const k = keyForIncoming(order, { at: at4pm, data: { platform: "didi", orderId: "1", total: 129, items: items1 } }, at0030);
check("repite número de ayer → llave aparte (no se borra el anterior)", k === "didi|1|202611220030", k);
check("reimpresión del mismo día → \"\" (duplicado)", keyForIncoming(order, { at: mx("2026-11-22T00:10:00"), data: { platform: "didi", orderId: "1" } }, at0030) === "");
check("orderKey usa la llave guardada", orderKey({ platform: "didi", orderId: "1", bridgeKey: "didi|1|202611220030" }) === "didi|1|202611220030");
check("orderKey sin llave guardada → normal", orderKey({ platform: "DiDi", orderId: "1" }) === "didi|1");
check("llave de otro pedido no se acepta", validKey("didi|11|202611220030", baseOrderKey({ platform: "didi", orderId: "1" })) === "");
check("llave inventada no se acepta", validKey("didi|1|x", "didi|1") === "" && validKey("didi|1|202611220030", "didi|1") === "didi|1|202611220030");
check("repeatKey", repeatKey("didi|7", at0030) === "didi|7|202611220030");

// Ventas: la del #1 de las 4 pm no tapa la del #1 de las 00:30
const saleAyer = { externalOrderKey: "didi:1", createdAt: new Date(at4pm).toISOString(), bridgeKey: "didi|1" };
check("venta: llaves distintas → otra venta", !isSameSale(saleAyer, { bridgeKey: "didi|1|202611220030", at: at0030, platform: "didi" }));
check("venta: misma llave → ya existe (no se cobra dos veces)", isSameSale(saleAyer, { bridgeKey: "didi|1", at: at4pm + 60000, platform: "didi" }));
const saleVieja = { externalOrderKey: "didi:1", createdAt: new Date(at4pm).toISOString() };
check("venta de antes (sin llave), DiDi otro día → otra venta", !isSameSale(saleVieja, { bridgeKey: "didi|1|202611220030", at: at0030, platform: "didi" }));
check("venta de antes (sin llave), DiDi mismo día → ya existe", isSameSale(saleVieja, { bridgeKey: "didi|1", at: mx("2026-11-21T18:00:00"), platform: "didi" }));
check("venta de antes Uber en 12 h → ya existe", isSameSale({ externalOrderKey: "uber:7FD5A", createdAt: new Date(at4pm).toISOString() }, { at: at0030, platform: "uber" }));

console.log(`\n${ok} bien, ${bad} mal`);
if (bad) process.exit(1);
