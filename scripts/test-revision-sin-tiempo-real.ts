/** La caja revisa la nube más seguido cuando no le llegan los avisos al instante */
import { pollEveryMs, RELISTEN_AFTER_MS, shouldRelisten } from "../lib/cloud/sync";
let ok = 0, bad = 0;
const check = (name: string, cond: boolean) => (cond ? (ok++, console.log("OK   ", name)) : (bad++, console.log("MAL  ", name)));
check("con tiempo real y a la vista: cada minuto", pollEveryMs(true, true) === 60_000);
check("sin tiempo real y a la vista: cada 10 s", pollEveryMs(false, true) === 10_000);
check("sin tiempo real escondida: cada 30 s", pollEveryMs(false, false) === 30_000);
check("con tiempo real escondida: sigue revisando", pollEveryMs(true, false) === 120_000);
check("sin tiempo real siempre más seguido", pollEveryMs(false, true) < pollEveryMs(true, true) && pollEveryMs(false, false) < pollEveryMs(true, false));
// 28 nov: la caja perdía el tiempo real y no volvía (mensajes de 6 a 9 s): se reconecta sola
check("con tiempo real no se reconecta", !shouldRelisten(true, 0, 10 * RELISTEN_AFTER_MS, true));
check("recién caído espera un poco", !shouldRelisten(false, 1_000, 1_000 + RELISTEN_AFTER_MS - 1, true));
check("caído un rato: se reconecta", shouldRelisten(false, 1_000, 1_000 + RELISTEN_AFTER_MS, true));
check("sin internet no lo intenta", !shouldRelisten(false, 0, 10 * RELISTEN_AFTER_MS, false));
check("se reconecta en menos de un minuto", RELISTEN_AFTER_MS <= 60_000);
console.log(`${ok} bien, ${bad} mal`);
process.exit(bad ? 1 : 0);
