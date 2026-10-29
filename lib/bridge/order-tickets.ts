"use client";
import QRCode from "qrcode";
import type { KitchenStation } from "@/data/products";
import type { BusinessSettings } from "@/lib/business-settings";
import type { OrderInterpretation } from "@/lib/bridge/interpret-order";
import { buildDeliveryTicket, ticketStations, type DeliveryTicket } from "@/lib/bridge/delivery-ticket";
import { stationsByLine } from "@/lib/bridge/station-routing";
import { bagTicketHtml, stationTicketHtml, type PaperWidth } from "@/lib/bridge/ticket-html";

export type OrderTicket = { target: KitchenStation | "Caja"; html: string };

/** Ancho del papel configurado en Configuración → Impresoras (58 u 80 mm). */
export function paperWidth(): PaperWidth {
  try {
    return Number(JSON.parse(localStorage.getItem("bpos_station_printers") || "{}")?.paperWidthMm) === 58 ? 58 : 80;
  } catch {
    return 80;
  }
}

/** SVG del QR del ticket de bolsa ("" si no hay texto configurado). */
export async function qrSvg(text: string) {
  if (!text.trim()) return "";
  return QRCode.toString(text.trim(), { type: "svg", margin: 0, errorCorrectionLevel: "M" });
}

/**
 * Tickets propios de un pedido de delivery: uno por estación con solo lo
 * suyo y, si está activado, el de la bolsa con precios (va a Caja).
 */
export async function buildOrderTickets(
  order: {
    platform?: string;
    orderId?: string | null;
    rawText?: string;
    receivedAt?: string;
    bridgeReceivedAt?: string;
    total?: number;
    customer?: { name?: string | null };
    interpretation?: OrderInterpretation;
  },
  catalog: { products: { id: number | string; station?: string }[]; recipes: { productId: number; ingredientId: number }[] },
  settings: BusinessSettings
): Promise<{ ticket: DeliveryTicket; tickets: OrderTicket[] }> {
  const routing = stationsByLine(order.interpretation, catalog.products as { id: number | string; station?: KitchenStation }[], catalog.recipes);
  const ticket = buildDeliveryTicket(order, routing);
  const paper = paperWidth();
  const tickets: OrderTicket[] = ticketStations(ticket).map((station) => ({
    target: station,
    html: stationTicketHtml(ticket, station, settings, paper),
  }));
  if (settings.bagTicketEnabled) {
    tickets.push({ target: "Caja", html: bagTicketHtml(ticket, settings, await qrSvg(settings.ticketQrText), paper) });
  }
  return { ticket, tickets };
}
