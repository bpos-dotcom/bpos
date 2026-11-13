/**
 * Dominios propios → página del negocio en B-POS.
 *   npx tsx scripts/test-dominios.ts
 */
import { domainRedirects, parseDomainRedirects } from "@/lib/domain-redirects";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

const p = parseDomainRedirects("burgerplanet.com.mx=/m/burger-planet, https://www.otro.mx/=fidelidad/otro ,malo=/x,sinruta.mx=");
check("lee los dominios", p.length === 2, p);
check("sin www y con su ruta", p[0].host === "burgerplanet.com.mx" && p[0].path === "/m/burger-planet");
check("limpia https, www y diagonal", p[1].host === "otro.mx" && p[1].path === "/fidelidad/otro", p[1]);
check("sin variable: nada", domainRedirects(undefined).length === 0 && domainRedirects("").length === 0);

const r = domainRedirects("burgerplanet.com.mx=/m/burger-planet");
check("con y sin www", r.some((x) => x.has[0].value === "burgerplanet.com.mx") && r.some((x) => x.has[0].value === "www.burgerplanet.com.mx"));
check("la raíz y cualquier ruta (el /Landing-Page/ del QR)", r.some((x) => x.source === "/") && r.some((x) => x.source === "/:path*"));
check("todas llevan al menú", r.every((x) => x.destination === "https://www.bpos.com.mx/m/burger-planet"));
check("no permanente (se puede cambiar después)", r.every((x) => x.permanent === false));

console.log(`\n${ok} bien, ${bad} mal`);
process.exit(bad ? 1 : 0);
