/**
 * Ticket del cliente del kiosco (corre en el servidor): el mismo diseño del
 * ticket de Caja de B-POS (lib/bridge/ticket-html.ts), armado con el pedido
 * en línea y los ajustes de ticket del negocio (Configuración → Tickets,
 * sincronizados en bpos_business_settings).
 */
import QRCode from "qrcode";
import type { BusinessSettings, TicketSize } from "@/lib/business-settings";
import type { DeliveryTicket, TicketItem } from "@/lib/bridge/delivery-ticket";
import { bagTicketHtml, type PaperWidth } from "@/lib/bridge/ticket-html";
import { kioskLabel, type OnlineOrderData } from "@/lib/digital-menu";

const SIZES: TicketSize[] = ["normal", "grande", "extra"];

/** Ajustes de ticket tal como los guarda B-POS (mismos valores por defecto que lib/business-settings.ts). */
export function ticketSettings(raw: unknown, businessName: string): BusinessSettings {
  const r = (raw || {}) as Partial<BusinessSettings>;
  const text = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
  const size = (v: unknown, fallback: TicketSize) => (SIZES.includes(v as TicketSize) ? (v as TicketSize) : fallback);
  const dataImage = (v: unknown) => (text(v, "").startsWith("data:image/") ? text(v, "") : "");
  return {
    businessName: String(r.businessName || businessName || "Mi negocio").trim(),
    ownerWhatsapp: "",
    brandLogo: dataImage(r.brandLogo),
    brandColor: "#f97316",
    ticketLogo: dataImage(r.ticketLogo),
    ticketPhone: text(r.ticketPhone, "").trim(),
    ticketNotice: text(r.ticketNotice, "").trim(),
    ticketFooter: text(r.ticketFooter, "¡Gracias por tu pedido!").trim(),
    ticketQrText: text(r.ticketQrText, "").trim(),
    ticketQrCaption: text(r.ticketQrCaption, "Escanea para pedir directo").trim(),
    ticketCutSpace: Number.isFinite(Number(r.ticketCutSpace)) ? Math.min(60, Math.max(0, Math.round(Number(r.ticketCutSpace)))) : 15,
    fallbackStation: "Cocina",
    bagTicketEnabled: true,
    ticketFontSize: size(r.ticketFontSize, "grande"),
    ticketLogoSize: size(r.ticketLogoSize, "grande"),
    ticketShowCustomer: r.ticketShowCustomer !== false,
    ticketShowChoices: r.ticketShowChoices !== false,
  };
}

/** El pedido del kiosco en el formato de los tickets de B-POS. */
export function kioskTicket(order: { folio: string; created_at: string; data: OnlineOrderData }): DeliveryTicket {
  const d = order.data;
  const items: TicketItem[] = d.lines.map((line, index) => {
    const qty = Number(line.quantity) || 1;
    // El resumen viene como "Aderezo: Ranch · Refresco: Coca": cada parte es una elección
    const choices = String(line.summary || "")
      .split(" · ")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const i = s.indexOf(": ");
        return i > 0 ? { qty: 1, name: s.slice(i + 2), price: null, question: s.slice(0, i) } : { qty: 1, name: s, price: null };
      });
    return {
      index,
      qty,
      name: line.name,
      price: Number(line.unitPrice) * qty,
      choices,
      notes: line.comment ? [line.comment] : [],
      stations: [],
      pending: false,
    };
  });
  return {
    kind: "mostrador",
    platform: kioskLabel(d) || "Kiosco",
    orderId: order.folio,
    customer: d.customer.name && d.customer.name !== "Cliente del kiosco" ? d.customer.name : null,
    receivedAt: order.created_at,
    items,
    charges: [],
    total: Number(d.total),
    payment: "Tarjeta · terminal",
  };
}

/** HTML listo para el Agent (lo dibuja al ancho del papel y lo manda a la térmica). */
export async function kioskTicketHtml(order: { folio: string; created_at: string; data: OnlineOrderData }, settings: BusinessSettings, paper: PaperWidth) {
  const qr = settings.ticketQrText ? await QRCode.toString(settings.ticketQrText, { type: "svg", margin: 0, errorCorrectionLevel: "M" }) : "";
  return bagTicketHtml(kioskTicket(order), settings, qr, paper);
}
