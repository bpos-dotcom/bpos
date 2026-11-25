/**
 * Botón WhatsApp de un pedido (Historial de pedidos): en vez de mandar solo
 * el ticket, abre opciones y cada una abre WhatsApp con el mensaje escrito
 * (gratis, sin API; el negocio solo le da enviar):
 *  - su ticket;
 *  - ya está listo (para llevar) / va en camino (a domicilio);
 *  - ya fue entregado, gracias;
 *  - invitarlo al club (si no es socio y el club está activo);
 *  - el menú en línea para pedir directo la próxima vez;
 *  - escribirle algo libre (abre el chat sin mensaje).
 * Lo que ya se mandó queda con la hora en el pedido (`notices`), igual que los
 * avisos de las cuentas en espera (lib/pending-notices.ts).
 */
import { isDeliveryOrder, noticeText, type NoticeContext, type PendingNotice } from "@/lib/pending-notices";

export type SaleWhatsappOption = "ticket" | PendingNotice | "club" | "menu" | "libre";

export const SALE_WHATSAPP_LABEL: Record<SaleWhatsappOption, string> = {
  ticket: "🧾 Mandar su ticket",
  listo: "✅ Ya está listo, pasa por él",
  camino: "🛵 Ya va en camino",
  entregado: "📦 Ya fue entregado · gracias",
  club: "⭐ Invitar al club",
  menu: "📲 Mandarle el menú en línea",
  libre: "✍️ Escribirle algo libre",
};

export type SaleWhatsappOrder = {
  items: { quantity: number; name: string; price: number; parts?: { name: string }[] }[];
  subtotal: number;
  total: number;
  details: { orderType?: string; paymentMethod?: string; discount?: number; customerName?: string; customerPhone?: string; customerAddress?: string };
  notices?: Partial<Record<string, string>>;
};

const money = (n: unknown) => (Number(n) || 0).toFixed(2);
const firstName = (order: SaleWhatsappOrder) => (order.details.customerName || "").trim().split(/\s+/)[0] || "";

/** El ticket del pedido como mensaje */
export function saleTicketText(order: SaleWhatsappOrder, ctx: Pick<NoticeContext, "businessName" | "folio">) {
  const business = ctx.businessName || "nuestro negocio";
  const items = order.items
    .map((item) => `• ${item.quantity} x ${item.name} - ${money(item.price * item.quantity)}${item.parts?.length ? ` (${item.parts.map((p) => p.name).join(", ")})` : ""}`)
    .join("\n");
  const discount = Number(order.details.discount) || 0;
  return [
    `🧾 *${business} - Ticket #${ctx.folio}*`,
    "",
    `Hola ${order.details.customerName || "Cliente"}, este es tu pedido:`,
    "",
    items,
    "",
    `Subtotal: $${money(order.subtotal)}`,
    ...(discount ? [`Descuento: -$${money(discount)}`] : []),
    `Total: *$${money(order.total)}*`,
    "",
    ...(order.details.orderType ? [`Tipo: ${order.details.orderType}`] : []),
    ...(order.details.paymentMethod ? [`Pago: ${order.details.paymentMethod}`] : []),
    "",
    `Gracias por pedir en ${business} 🚀`,
  ].join("\n");
}

/** Qué opciones salen para este pedido */
export function saleWhatsappOptions(order: SaleWhatsappOrder, ctx: Pick<NoticeContext, "member" | "club" | "menuUrl">): SaleWhatsappOption[] {
  return [
    "ticket",
    isDeliveryOrder(order) ? "camino" : "listo",
    "entregado",
    ...(ctx.member === false && ctx.club?.url ? (["club"] as const) : []),
    ...(ctx.menuUrl ? (["menu"] as const) : []),
    "libre",
  ];
}

/** El mensaje de cada opción ("" para escribir algo libre) */
export function saleWhatsappText(order: SaleWhatsappOrder, option: SaleWhatsappOption, ctx: NoticeContext) {
  const name = firstName(order);
  const business = ctx.businessName || "nuestro negocio";
  switch (option) {
    case "ticket":
      return saleTicketText(order, ctx);
    case "listo":
    case "camino":
    case "entregado":
      return noticeText(order as Parameters<typeof noticeText>[0], option, ctx);
    case "club": {
      const club = ctx.club;
      if (!club?.url) return "";
      return (
        `⭐ ¡Hola${name ? ` ${name}` : ""}! Únete gratis a *${club.name || `el club de ${business}`}* y gana en cada compra` +
        (club.welcome ? ` (te regalamos ${club.welcome})` : "") +
        `: ${club.url}`
      );
    }
    case "menu":
      return ctx.menuUrl ? `📲 ¡Hola${name ? ` ${name}` : ""}! La próxima vez pide directo a ${business} desde nuestro menú en línea: ${ctx.menuUrl}` : "";
    case "libre":
      return "";
  }
}

/** El pedido con la hora en que se mandó una opción ("libre" no se marca) */
export function markSaleWhatsapp<T extends SaleWhatsappOrder>(order: T, option: SaleWhatsappOption, at: string): T {
  if (option === "libre") return order;
  return { ...order, notices: { ...(order.notices || {}), [option]: at } };
}
