/**
 * Avisos por WhatsApp de las cuentas en espera del POS (con el WhatsApp del
 * cliente capturado): "ya está listo", "va en camino" (a domicilio) y
 * "entregado". Se abre WhatsApp con el mensaje escrito y el negocio solo le
 * da enviar (gratis, sin API).
 *
 * Si el cliente no es del club, el primer aviso de "va en camino" o
 * "entregado" lo invita a unirse y a pedir la próxima vez por el menú en línea.
 */
import { whatsappNumber } from "@/lib/digital-menu";

export type PendingNotice = "listo" | "camino" | "entregado";

export const NOTICE_LABEL: Record<PendingNotice, string> = {
  listo: "✅ Avisar que ya está listo",
  camino: "🛵 Avisar que va en camino",
  entregado: "📦 Avisar entregado",
};

type NoticeOrder = {
  details: { orderType?: string; customerName?: string; customerPhone?: string; customerAddress?: string };
  /** Cuándo se mandó cada aviso */
  notices?: Partial<Record<PendingNotice, string>>;
};

/** ¿Es a domicilio? (o lleva dirección) */
export function isDeliveryOrder(order: NoticeOrder) {
  return order.details.orderType === "Domicilio" || Boolean(order.details.customerAddress?.trim());
}

/** Los botones de la cuenta en espera ([] si no tiene un WhatsApp válido) */
export function pendingNotices(order: NoticeOrder): PendingNotice[] {
  if (!whatsappNumber(order.details.customerPhone || "")) return [];
  return isDeliveryOrder(order) ? ["camino", "entregado"] : ["listo", "entregado"];
}

export type NoticeContext = {
  businessName: string;
  /** Folio que ve el cliente: "000026" */
  folio: string;
  /** true = es socio; false = no; null = no se sabe (sin internet): no se invita */
  member: boolean | null;
  /** El club está activo: su nombre ("Club BP") y su liga para unirse */
  club?: { name: string; url: string; welcome?: string } | null;
  /** Liga del menú en línea para pedir la próxima vez */
  menuUrl?: string;
};

/** ¿Este aviso lleva la invitación al club? Solo una vez por pedido. */
export function noticeInvites(order: NoticeOrder, notice: PendingNotice, ctx: Pick<NoticeContext, "member" | "club">) {
  if (notice === "listo" || ctx.member !== false || !ctx.club?.url) return false;
  const sent = order.notices || {};
  return !(["camino", "entregado"] as PendingNotice[]).some((n) => n !== notice && sent[n]);
}

export function noticeText(order: NoticeOrder, notice: PendingNotice, ctx: NoticeContext) {
  const name = (order.details.customerName || "").trim().split(/\s+/)[0] || "";
  const hi = name ? `${name}, ` : "";
  const business = ctx.businessName || "nuestro negocio";
  const base: Record<PendingNotice, string> = {
    listo: `✅ ¡${hi}tu pedido *#${ctx.folio}* ya está listo! Pasa a recogerlo a ${business}.`,
    camino: `🛵 ¡${hi}tu pedido *#${ctx.folio}* de ${business} ya va en camino!`,
    entregado: `🎉 ¡Gracias por tu pedido${name ? `, ${name}` : ""}! Esperamos que lo disfrutes 😋`,
  };
  let text = base[notice];
  if (noticeInvites(order, notice, ctx) && ctx.club) {
    text +=
      `\n\n⭐ Únete gratis a *${ctx.club.name || `el club de ${business}`}* y gana en cada compra` +
      (ctx.club.welcome ? ` (te regalamos ${ctx.club.welcome})` : "") +
      `: ${ctx.club.url}`;
    if (ctx.menuUrl) text += `\n\n📲 La próxima vez pide directo desde nuestro menú: ${ctx.menuUrl}`;
  }
  return text;
}
