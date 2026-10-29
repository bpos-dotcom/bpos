import type { KitchenStation } from "@/data/products";
import type { BusinessSettings } from "@/lib/business-settings";
import type { DeliveryTicket, TicketItem } from "@/lib/bridge/delivery-ticket";

/**
 * Tickets propios (HTML) que el Agent convierte en imagen y manda a la
 * térmica. Ancho fijo de 576 px = 80 mm a 203 dpi; en 58 mm se escala.
 * Todo en negro sobre blanco: las térmicas no imprimen color.
 */
const WIDTH = 576;

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "";
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function time(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

const STYLE = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { width: ${WIDTH}px; padding: 18px 22px 28px; font-family: Arial, Helvetica, sans-serif; font-size: 26px; line-height: 1.25; }
  .center { text-align: center; }
  .logo { display: block; margin: 0 auto 10px; max-width: 78%; max-height: 190px; }
  .platform { font-size: 34px; font-weight: 900; }
  .order { font-size: 44px; font-weight: 900; margin-top: 2px; }
  .muted { font-size: 22px; }
  .banner { margin: 14px 0 10px; padding: 8px 0; background: #000; color: #fff; font-size: 38px; font-weight: 900; letter-spacing: 2px; text-align: center; }
  .rule { border-top: 3px dashed #000; margin: 12px 0; }
  .item { margin: 10px 0; }
  .row { display: flex; justify-content: space-between; gap: 12px; }
  .row .name { flex: 1; }
  .qty { font-weight: 900; }
  .big { font-size: 32px; font-weight: 900; }
  .sub { padding-left: 34px; font-size: 23px; }
  .note { padding-left: 34px; font-size: 23px; font-style: italic; }
  .warn { padding-left: 34px; font-size: 22px; font-weight: 900; }
  .total { font-size: 34px; font-weight: 900; }
  .notice { font-size: 21px; text-align: center; margin-top: 8px; }
  .qr { display: block; margin: 12px auto 4px; width: 210px; height: 210px; }
  .qr svg { width: 100%; height: 100%; }
`;

function page(body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${body}</body></html>`;
}

function header(ticket: DeliveryTicket, settings: BusinessSettings) {
  const logo = settings.ticketLogo
    ? `<img class="logo" src="${settings.ticketLogo}">`
    : `<div class="center big">${esc(settings.businessName)}</div>`;
  return `${logo}
    <div class="center platform">${esc(ticket.platform)}</div>
    <div class="center order">Pedido #${esc(ticket.orderId)}</div>
    <div class="center muted">${esc(ticket.customer || "")}${ticket.customer ? " · " : ""}${esc(time(ticket.receivedAt))}</div>`;
}

function itemBlock(item: TicketItem, withPrices: boolean) {
  const choices = item.choices
    .map(
      (c) =>
        `<div class="sub row"><span class="name">${c.question ? `${esc(c.question)} ` : ""}<b>${c.qty > 1 ? `${c.qty}x ` : ""}${esc(c.name)}</b></span>${
          withPrices && c.price ? `<span>${money(c.price)}</span>` : ""
        }</div>`
    )
    .join("");
  const notes = item.notes.map((n) => `<div class="note">${esc(n)}</div>`).join("");
  const warn = !withPrices && item.pending ? `<div class="warn">⚠ Sin equivalencia: revisar en el Bridge</div>` : "";
  return `<div class="item">
    <div class="row ${withPrices ? "" : "big"}"><span class="name"><span class="qty">${item.qty}x</span> ${esc(item.name)}</span>${
      withPrices ? `<span>${money(item.price)}</span>` : ""
    }</div>${choices}${notes}${warn}</div>`;
}

/** Ticket de una estación: encabezado + solo los productos que le tocan. */
export function stationTicketHtml(ticket: DeliveryTicket, station: KitchenStation, settings: BusinessSettings) {
  const items = ticket.items.filter((i) => i.stations.includes(station));
  return page(`${header(ticket, settings)}
    <div class="banner">${esc(station.toUpperCase())}</div>
    ${items.map((i) => itemBlock(i, false)).join("")}
    <div class="rule"></div>
    <div class="center muted">${items.reduce((s, i) => s + i.qty, 0)} producto(s) · ${esc(time(new Date().toISOString()))}</div>`);
}

/** Aclaración con {plataforma} {negocio} {telefono} reemplazados. */
export function noticeText(ticket: DeliveryTicket, settings: BusinessSettings) {
  return settings.ticketNotice
    .replace(/\{plataforma\}/gi, ticket.platform)
    .replace(/\{negocio\}/gi, settings.businessName)
    .replace(/\{telefono\}/gi, settings.ticketPhone || "");
}

/** Ticket para grapar en la bolsa: todo el pedido con precios de la plataforma. */
export function bagTicketHtml(ticket: DeliveryTicket, settings: BusinessSettings, qrSvg = "") {
  const charges = ticket.charges.map((c) => `<div class="row"><span>${esc(c.label)}</span><span>${money(c.amount)}</span></div>`).join("");
  return page(`${header(ticket, settings)}
    <div class="rule"></div>
    ${ticket.items.map((i) => itemBlock(i, true)).join("")}
    <div class="rule"></div>
    ${charges}
    ${ticket.total !== null ? `<div class="row total"><span>Total</span><span>${money(ticket.total)}</span></div>` : ""}
    <div class="rule"></div>
    ${settings.ticketNotice ? `<div class="notice">${esc(noticeText(ticket, settings))}</div>` : ""}
    ${qrSvg ? `<div class="qr">${qrSvg}</div>` : ""}
    ${settings.ticketFooter ? `<div class="center big" style="margin-top:8px">${esc(settings.ticketFooter)}</div>` : ""}`);
}
