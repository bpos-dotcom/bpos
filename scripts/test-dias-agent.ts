/**
 * Días que guarda la caja: 10 de ventas y 2 de kardex en el navegador; 30 y
 * 30 en la caja local del Agent, contando desde que se pasó (sin huecos).
 *   npx tsx scripts/test-dias-agent.ts
 */
import { localOrdersCutoff, ordersLocalDays } from "@/lib/order-archive";
import { kardexLocalDays, localKardexCutoff } from "@/lib/kardex-archive";
import { daysCovered } from "@/lib/local-days";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

const now = new Date(2026, 11, 20, 15, 0); // 20 dic
check("navegador: 10 días de ventas", ordersLocalDays(false) === 10 && daysCovered(now, localOrdersCutoff(now, false)) === 10);
check("navegador: 2 días de kardex", kardexLocalDays(false) === 2 && daysCovered(now, localKardexCutoff(now, false)) === 2);
check("Agent: 30 días de ventas y de kardex", ordersLocalDays(true) === 30 && kardexLocalDays(true) === 30);

// Se pasó al Agent el 5 dic: trae 10 días de ventas (desde 25 nov) y 2 de kardex (desde 3 dic)
const since = new Date(2026, 11, 5, 9, 0);
const o = localOrdersCutoff(now, true, since);
check("Agent recién pasado: ventas completas desde 25 nov (lo de antes, nube)", o.getTime() === new Date(2026, 10, 25).getTime(), o);
const k = localKardexCutoff(now, true, since);
check("Agent recién pasado: kardex completo desde 3 dic", k.getTime() === new Date(2026, 11, 3).getTime(), k);
check("letrero de ventas dice 25 días", daysCovered(now, o) === 25, daysCovered(now, o));

// Un mes después ya tiene sus 30 días completos
const later = new Date(2027, 0, 20, 15, 0);
check("Agent después de un mes: 30 días de ventas", daysCovered(later, localOrdersCutoff(later, true, since)) === 30);
check("Agent después de un mes: 30 días de kardex", daysCovered(later, localKardexCutoff(later, true, since)) === 30);

console.log(`\n${ok} bien, ${bad} mal`);
if (bad) process.exit(1);
