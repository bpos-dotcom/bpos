/**
 * Avisos por WhatsApp de las cuentas en espera del POS.
 *   npx tsx scripts/test-avisos-espera.ts
 */
import { noticeInvites, noticeText, pendingNotices } from "@/lib/pending-notices";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

const club = { name: "Club BP", url: "https://www.bpos.com.mx/fidelidad/bp", welcome: "Papas gratis" };
const ctx = { businessName: "Mi Negocio", folio: "000026", member: false as boolean | null, club, menuUrl: "https://www.bpos.com.mx/m/bp" };

const llevar = { details: { orderType: "Mostrador", customerName: "Juan Pérez", customerPhone: "871 123 4567" } };
const domicilio = { details: { orderType: "Domicilio", customerName: "Ana", customerPhone: "8711234567", customerAddress: "Calle 1" } };
const sinTel = { details: { orderType: "Mostrador", customerName: "Luis", customerPhone: "" } };

check("sin WhatsApp: no hay botones", pendingNotices(sinTel).length === 0);
check("número incompleto: no hay botones", pendingNotices({ details: { customerPhone: "12345" } }).length === 0);
check("para recoger: listo y entregado", pendingNotices(llevar).join(",") === "listo,entregado", pendingNotices(llevar));
check("a domicilio: en camino y entregado", pendingNotices(domicilio).join(",") === "camino,entregado", pendingNotices(domicilio));
check("con dirección cuenta como domicilio", pendingNotices({ details: { orderType: "WhatsApp", customerPhone: "8711234567", customerAddress: "Av. 2" } })[0] === "camino");

const listo = noticeText(llevar, "listo", ctx);
check("listo: nombre, folio y negocio", listo.includes("Juan,") && listo.includes("#000026") && listo.includes("Mi Negocio"), listo);
check("listo: no invita al club", !listo.includes("Club BP"));

const entregado = noticeText(llevar, "entregado", ctx);
check("entregado sin club: lo invita con la liga y el regalo", entregado.includes("Club BP") && entregado.includes(club.url) && entregado.includes("Papas gratis"), entregado);
check("entregado sin club: liga del menú para la próxima", entregado.includes(ctx.menuUrl));

check("socio: no se le invita", !noticeText(llevar, "entregado", { ...ctx, member: true }).includes("Club BP"));
check("no se sabe si es socio (sin internet): no se invita", !noticeText(llevar, "entregado", { ...ctx, member: null }).includes("Club BP"));
check("club apagado: no se invita", !noticeText(llevar, "entregado", { ...ctx, club: null }).includes("Únete"));

const camino = noticeText(domicilio, "camino", ctx);
check("en camino sin club: invita", camino.includes("ya va en camino") && camino.includes(club.url), camino);
check("ya se invitó en camino: el entregado ya no", !noticeInvites({ ...domicilio, notices: { camino: new Date().toISOString() } }, "entregado", ctx));
check("reenviar el mismo aviso sí vuelve a invitar", noticeInvites({ ...domicilio, notices: { camino: new Date().toISOString() } }, "camino", ctx));
check("sin menú en línea: invita sin esa liga", !noticeText(llevar, "entregado", { ...ctx, menuUrl: "" }).includes("/m/"));

console.log(`\n${ok} bien, ${bad} mal`);
process.exit(bad ? 1 : 0);
