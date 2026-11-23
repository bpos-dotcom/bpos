/** La caja revisa la nube más seguido cuando no le llegan los avisos al instante */
import { pollEveryMs } from "../lib/cloud/sync";
let ok = 0, bad = 0;
const check = (name: string, cond: boolean) => (cond ? (ok++, console.log("OK   ", name)) : (bad++, console.log("MAL  ", name)));
check("con tiempo real y a la vista: cada minuto", pollEveryMs(true, true) === 60_000);
check("sin tiempo real y a la vista: cada 10 s", pollEveryMs(false, true) === 10_000);
check("sin tiempo real escondida: cada 30 s", pollEveryMs(false, false) === 30_000);
check("con tiempo real escondida: sigue revisando", pollEveryMs(true, false) === 120_000);
check("sin tiempo real siempre más seguido", pollEveryMs(false, true) < pollEveryMs(true, true) && pollEveryMs(false, false) < pollEveryMs(true, false));
console.log(`${ok} bien, ${bad} mal`);
process.exit(bad ? 1 : 0);
