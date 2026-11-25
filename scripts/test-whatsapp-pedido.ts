/**
 * Botón WhatsApp de un pedido: qué opciones salen y qué mensaje lleva cada una.
 *   npx tsx scripts/test-whatsapp-pedido.ts
 */
import { markSaleWhatsapp, saleWhatsappOptions, saleWhatsappText } from "../lib/sale-whatsapp";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

const llevar = {
  items: [
    { quantity: 2, name: "Boneless Orden Individual", price: 104 },
    { quantity: 1, name: "Combo Especial", price: 189, parts: [{ name: "Hamburguesa NewYork BBQ" }, { name: "Dr Pepper" }] },
  ],
  subtotal: 397,
  total: 397,
  details: { orderType: "Mostrador", paymentMethod: "Tarjeta", discount: 0, customerName: "Chuy Gerardo", customerPhone: "871 123 4567" },
};
const domicilio = { ...llevar, details: { ...llevar.details, orderType: "Domicilio", customerAddress: "Calle 1 #2" } };
const club = { name: "Club BP", url: "https://www.bpos.com.mx/fidelidad/bp", welcome: "unas papas" };
const ctx = { businessName: "Burger Point", folio: "000926", member: false, club, menuUrl: "https://www.bpos.com.mx/m/bp" };

check("para llevar: ticket, listo, entregado, club, menú y libre", JSON.stringify(saleWhatsappOptions(llevar, ctx)) === JSON.stringify(["ticket", "listo", "entregado", "club", "menu", "libre"]), saleWhatsappOptions(llevar, ctx));
check("a domicilio: 'va en camino' en vez de 'listo'", saleWhatsappOptions(domicilio, ctx).includes("camino") && !saleWhatsappOptions(domicilio, ctx).includes("listo"));
check("socio del club: no se le invita", !saleWhatsappOptions(llevar, { ...ctx, member: true }).includes("club"));
check("sin saber si es socio (sin internet): no se le invita", !saleWhatsappOptions(llevar, { ...ctx, member: null }).includes("club"));
check("sin club activo: no hay invitación", !saleWhatsappOptions(llevar, { ...ctx, club: null }).includes("club"));
check("sin menú en línea: no hay opción de menú", !saleWhatsappOptions(llevar, { ...ctx, menuUrl: "" }).includes("menu"));

const ticket = saleWhatsappText(llevar, "ticket", ctx);
check("ticket: folio, productos con sus partes y total", ticket.includes("Ticket #000926") && ticket.includes("2 x Boneless Orden Individual - 208.00") && ticket.includes("(Hamburguesa NewYork BBQ, Dr Pepper)") && ticket.includes("*$397.00*"), ticket);
check("ticket sin descuento: no dice 'Descuento: -$0.00'", !ticket.includes("Descuento"), ticket);
check("ticket con descuento sí lo dice", saleWhatsappText({ ...llevar, total: 377, details: { ...llevar.details, discount: 20 } }, "ticket", ctx).includes("Descuento: -$20.00"));
check("listo: por su nombre y folio", saleWhatsappText(llevar, "listo", ctx).includes("Chuy, tu pedido *#000926* ya está listo"));
check("en camino", saleWhatsappText(domicilio, "camino", ctx).includes("ya va en camino"));
check("entregado da las gracias", saleWhatsappText(llevar, "entregado", ctx).includes("Gracias por tu pedido, Chuy"));
const invita = saleWhatsappText(llevar, "club", ctx);
check("club: nombre, regalo de bienvenida y liga", invita.includes("*Club BP*") && invita.includes("te regalamos unas papas") && invita.includes(club.url), invita);
check("menú: la liga del menú en línea", saleWhatsappText(llevar, "menu", ctx).includes(ctx.menuUrl));
check("libre: sin mensaje (solo abre el chat)", saleWhatsappText(llevar, "libre", ctx) === "");

const marcado = markSaleWhatsapp(llevar, "entregado", "2026-11-25T03:41:00.000Z");
check("lo mandado queda con la hora", marcado.notices?.entregado === "2026-11-25T03:41:00.000Z");
check("y no borra lo que ya se había mandado", markSaleWhatsapp(marcado, "club", "x").notices?.entregado === "2026-11-25T03:41:00.000Z");
check("el mensaje libre no se marca", markSaleWhatsapp(llevar, "libre", "x") === llevar);

console.log(`\n${ok} bien, ${bad} mal`);
if (bad) process.exit(1);
