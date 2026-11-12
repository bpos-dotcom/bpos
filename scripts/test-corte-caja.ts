/**
 * Totales y canales del mensaje del corte de caja.
 *   npx tsx scripts/test-corte-caja.ts
 */
import { channelsText, cutTotalsText, salesByChannel } from "@/lib/cash-cut";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

// El caso del correo: 3,150 locales (2,733 mostrador + 417 de otros tipos), Uber 1,461 y DiDi 1,066
const orders = [
  { total: 2733, details: { orderType: "Mostrador" } },
  { total: 300, details: { orderType: "Mesa" } },
  { total: 117, details: { orderType: "Recoger" } },
  { total: 1461, details: { orderType: "Uber Eats" } },
  { total: 1066, details: { orderType: "Didi Food" } },
];
const total = 5677;
const platform = 2527;

const t = cutTotalsText(total, platform, [
  { sales: 1461, deposit: 788.94 },
  { sales: 1066, deposit: 619.35 },
]);
check("locales = efectivo + tarjeta + transferencia", t.includes("Total ventas locales: $3150.00"), t);
check("depósitos = suma de los aproximados", t.includes("Depósitos aprox. de apps: $1408.29"), t);
check("total = locales + depósitos", t.includes("Total (locales + depósitos): $4558.29"), t);
check("ya no sale 'Te queda aprox.'", !t.includes("Te queda"));
check("ya no sale el total con lo que cobra la app", !t.includes("5677"));

check("sin apps: un solo total", cutTotalsText(900, 0, []) === "📈 Total ventas: $900.00");
const sinComision = cutTotalsText(1500, 500, [{ sales: 500, deposit: null }]);
check("apps sin comisión: locales, ventas de apps y total", sinComision.includes("locales: $1000.00") && sinComision.includes("Ventas de apps: $500.00") && sinComision.includes("Total ventas: $1500.00"), sinComision);
const mezcla = cutTotalsText(1500, 500, [{ sales: 300, deposit: 200 }, { sales: 200, deposit: null }]);
check("una app sin comisión: lo avisa", mezcla.includes("sin contar las apps sin comisión") && mezcla.includes("$1200.00"), mezcla);

const rows = salesByChannel(orders);
check("canales suman el total", rows.reduce((s, r) => s + r.total, 0) === total, rows);
check("mesa y menú en línea sí salen", rows.some((r) => r.channel === "Mesa") && rows.some((r) => r.channel === "Recoger"));
check("de mayor a menor", rows[0].channel === "Mostrador" && rows[rows.length - 1].channel === "Recoger");
const text = channelsText(orders);
check("canal sin ventas no sale", !text.includes("WhatsApp"), text);
check("sin tipo cuenta como mostrador", salesByChannel([{ total: 50, details: {} }])[0].channel === "Mostrador");
check("turno sin ventas", channelsText([]) === "Sin ventas.");

console.log(`\n${ok} bien, ${bad} mal`);
process.exit(bad ? 1 : 0);
