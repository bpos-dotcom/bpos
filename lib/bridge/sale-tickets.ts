"use client";
import type { KitchenStation } from "@/data/products";
import { getBusinessSettings } from "@/lib/business-settings";
import { platformLabel, realCustomerName, type DeliveryTicket } from "@/lib/bridge/delivery-ticket";
import { paperWidth, qrSvg, type OrderTicket } from "@/lib/bridge/order-tickets";
import { bagTicketHtml, stationTicketHtml } from "@/lib/bridge/ticket-html";
import { printDeliveryTickets, printOriginalTicket } from "@/lib/localService";
import { formatOrderNumber } from "@/lib/order-sequence";
import { extrasPrice, groupedPicks, modifiersText, type SoldModifier, type SoldPart } from "@/lib/compound";

/**
 * Tickets de cualquier venta guardada (POS de mostrador o delivery) para
 * imprimir al cobrar y para reimprimir desde Impresiones.
 *
 * - Delivery: usa el ticket que armó el Bridge con los renglones del
 *   pedido original (`deliveryTicket`, guardado en la venta).
 * - Mostrador: se arma con los productos del POS (cada uno con su estación).
 */
export type SaleForTickets = {
  id: number;
  localOrderNumber?: number;
  createdAt: string;
  items: { name: string; price: number; quantity: number; station?: string; externalName?: string; parts?: SoldPart[]; modifiers?: SoldModifier[]; ownTicket?: boolean; comment?: string }[];
  details?: { orderType?: string; customerName?: string; paymentMethod?: string; discount?: number };
  subtotal?: number;
  total: number;
  externalPlatform?: string;
  externalOrderNumber?: string;
  deliveryTicket?: DeliveryTicket;
};

export const STATIONS: KitchenStation[] = ["Parrilla", "Freidora", "Barra", "Cocina"];

export function isDeliverySale(sale: SaleForTickets) {
  return Boolean(sale.externalPlatform || sale.deliveryTicket);
}

/** Datos del ticket de una venta (el del Bridge si es delivery). */
export function saleTicket(sale: SaleForTickets): DeliveryTicket {
  if (sale.deliveryTicket) return { ...sale.deliveryTicket, customer: realCustomerName(sale.deliveryTicket.customer) };
  const delivery = isDeliverySale(sale);
  const discount = Number(sale.details?.discount || 0);
  const subtotal = Number(sale.subtotal ?? sale.items.reduce((s, i) => s + i.price * i.quantity, 0));
  return {
    kind: delivery ? "delivery" : "mostrador",
    platform: delivery ? platformLabel(sale.externalPlatform) : sale.details?.orderType || "Mostrador",
    orderId: delivery && sale.externalOrderNumber ? String(sale.externalOrderNumber) : formatOrderNumber(sale),
    customer: realCustomerName(sale.details?.customerName),
    receivedAt: sale.createdAt,
    items: sale.items.map((item, index) => ({
      index,
      qty: Number(item.quantity) || 1,
      name: item.name,
      // El precio del renglón trae sumadas las opciones: en el ticket van aparte
      price: (Number(item.price) - extrasPrice(item.modifiers, item.parts)) * (Number(item.quantity) || 1),
      // Opciones (repetidas juntas: "2x BBQ") y, si pasó de las incluidas, el renglón de cobro
      choices: [
        ...groupedPicks(item.modifiers).map((r) => ({ qty: r.qty, name: r.name, price: null, question: r.group })),
        ...(item.modifiers || []).filter((m) => m.extra).map((m) => ({ qty: 1, name: m.name, price: m.price * (Number(item.quantity) || 1) })),
      ],
      notes: item.comment ? [item.comment] : [], // comentario para la cocina
      // Con productos enlazados: la estación de cada uno, y la suya salvo en combos
      stations: item.parts?.length
        ? STATIONS.filter((s) => item.parts!.some((p) => p.station === s) || (item.ownTicket && (item.station || "Cocina") === s))
        : [(item.station || "Cocina") as KitchenStation],
      pending: false,
      ...(item.parts?.length
        ? {
            parts: item.parts.map((p) => ({
              qty: (Number(p.quantity) || 1) * (Number(item.quantity) || 1),
              name: p.name,
              station: p.station,
              ...(p.modifiers?.length ? { extras: [modifiersText(p.modifiers)] } : {}),
            })),
          }
        : {}),
    })),
    charges: discount > 0 ? [{ label: "Subtotal", amount: subtotal }, { label: "Descuento", amount: -discount }] : [],
    total: Number(sale.total),
    payment: delivery ? undefined : sale.details?.paymentMethod,
  };
}

/** Estaciones que tienen algo en la venta. */
export function saleStations(sale: SaleForTickets): KitchenStation[] {
  const used = new Set(saleTicket(sale).items.flatMap((i) => i.stations));
  return STATIONS.filter((s) => used.has(s));
}

/** Arma los tickets elegidos: comandas de esas estaciones y/o el ticket del cliente (Caja). */
export async function buildSaleTickets(sale: SaleForTickets, choice: { stations: KitchenStation[]; customer: boolean }): Promise<OrderTicket[]> {
  const settings = getBusinessSettings();
  const paper = paperWidth();
  const ticket = saleTicket(sale);
  const tickets: OrderTicket[] = choice.stations
    .filter((station) => ticket.items.some((i) => i.stations.includes(station)))
    .map((station) => ({ target: station, html: stationTicketHtml(ticket, station, settings, paper) }));
  if (choice.customer) tickets.push({ target: "Caja", html: bagTicketHtml(ticket, settings, await qrSvg(settings.ticketQrText), paper) });
  return tickets;
}

/** Clave del pedido para el Agent (no repetir, reimprimir). */
function saleKey(sale: SaleForTickets) {
  return { platform: isDeliverySale(sale) ? String(sale.externalPlatform || "delivery") : "mostrador", orderId: isDeliverySale(sale) ? String(sale.externalOrderNumber || sale.id) : String(sale.id) };
}

/**
 * Imprime una venta. `force`: reimpresión (aunque ya se haya impreso).
 * Regresa los destinos que fallaron, con el motivo.
 */
export async function printSale(
  sale: SaleForTickets,
  choice: { stations: KitchenStation[]; customer: boolean; original?: boolean },
  force: boolean
): Promise<string[]> {
  const failed: string[] = [];
  const { platform, orderId } = saleKey(sale);
  const tickets = await buildSaleTickets(sale, choice);
  if (tickets.length) {
    const result = await printDeliveryTickets({ platform, orderId, tickets, force });
    (result.results || []).filter((r) => !r.ok).forEach((r) => failed.push(`${r.target}: ${r.error || "no salió"}`));
  }
  if (choice.original && isDeliverySale(sale)) {
    try {
      // El original sale en la impresora de Caja
      await printOriginalTicket({ platform, orderId, stations: ["Caja"], force: true });
    } catch (error) {
      failed.push(`Original: ${error instanceof Error ? error.message : "no salió"}`);
    }
  }
  return failed;
}
