import type { KitchenStation } from "@/data/products";
import type { BusinessSettings, TicketSize } from "@/lib/business-settings";
import type { DeliveryTicket, TicketItem } from "@/lib/bridge/delivery-ticket";

/**
 * Tickets propios (HTML) que el Agent dibuja al ancho real del papel y manda
 * a la térmica: 384 puntos en 58 mm, 576 en 80 mm (203 dpi).
 *
 * Reglas de térmica: todo en negro sólido (sin grises, sin cursivas ni
 * letra delgada, que salen tenues) y sin bloques negros grandes (en 58 mm
 * salen rayados): la estación va en un recuadro con marco grueso.
 */
export type PaperWidth = 58 | 80;

const FONT_SCALE: Record<TicketSize, number> = { normal: 1, grande: 1.2, extra: 1.45 };
const LOGO_HEIGHT: Record<TicketSize, number> = { normal: 70, grande: 100, extra: 135 };

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

function style(settings: BusinessSettings, paper: PaperWidth) {
  // Tamaño base pensado para leerse a un brazo de distancia
  const b = (paper === 58 ? 21 : 27) * FONT_SCALE[settings.ticketFontSize];
  const logo = LOGO_HEIGHT[settings.ticketLogoSize] * (paper === 58 ? 1 : 1.35);
  return `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; overflow: hidden; }
  ::-webkit-scrollbar { display: none; }
  body { width: 100%; padding: 6px 4px 14px; font-family: Arial, Helvetica, sans-serif; font-size: ${b}px; line-height: 1.2; font-weight: 700; }
  .center { text-align: center; }
  .logo { display: block; margin: 0 auto 6px; max-width: 100%; max-height: ${logo}px; }
  .platform { font-size: ${b * 1.25}px; font-weight: 900; }
  .order { font-size: ${b * 1.7}px; font-weight: 900; }
  .meta { font-size: ${b}px; }
  .station { margin: 8px 0; padding: 4px 0; border: 5px solid #000; font-size: ${b * 1.6}px; font-weight: 900; letter-spacing: 1px; text-align: center; }
  .rule { border-top: 3px solid #000; margin: 8px 0; }
  .item { margin: 7px 0; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .row .name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .price { flex-shrink: 0; white-space: nowrap; }
  .main { font-size: ${b * 1.3}px; font-weight: 900; }
  .main.priced { font-size: ${b * 1.1}px; }
  .sub { padding-left: ${b * 0.9}px; font-size: ${b}px; }
  .total { font-size: ${b * 1.45}px; font-weight: 900; }
  .notice { font-size: ${b * 0.95}px; text-align: center; margin-top: 6px; }
  .qr { display: block; margin: 8px auto 2px; width: ${b * 8}px; height: ${b * 8}px; }
  .qr svg { width: 100%; height: 100%; }
`;
}

function page(settings: BusinessSettings, paper: PaperWidth, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${style(settings, paper)}</style></head><body>${body}</body></html>`;
}

function header(ticket: DeliveryTicket, settings: BusinessSettings) {
  const logo = settings.ticketLogo
    ? `<img class="logo" src="${settings.ticketLogo}">`
    : `<div class="center platform">${esc(settings.businessName)}</div>`;
  const who = settings.ticketShowCustomer && ticket.customer ? `${esc(ticket.customer)} · ` : "";
  return `${logo}
    <div class="center platform">${esc(ticket.platform)}</div>
    <div class="center order">Pedido #${esc(ticket.orderId)}</div>
    <div class="center meta">${who}${esc(time(ticket.receivedAt))}</div>`;
}

function itemBlock(item: TicketItem, settings: BusinessSettings, withPrices: boolean, station?: KitchenStation) {
  // Combo: en la comanda solo las partes de esa estación; en el del cliente, todas
  const parts = (item.parts || [])
    .filter((p) => !station || p.station === station)
    .map((p) => `<div class="sub">» ${p.qty}x ${esc(p.name)}</div>${(p.extras || []).map((x) => `<div class="sub">&nbsp;&nbsp;* ${esc(x)}</div>`).join("")}`)
    .join("");
  const details = settings.ticketShowChoices
    ? item.choices
        .map(
          (c) =>
            `<div class="sub row"><span class="name">${c.question ? `${esc(c.question)} ` : ""}» ${c.qty > 1 ? `${c.qty}x ` : ""}${esc(c.name)}</span>${
              withPrices && c.price ? `<span class="price">${money(c.price)}</span>` : ""
            }</div>`
        )
        .join("")
    : "";
  // Notas y comentarios ("sin cebolla") siempre salen, aunque las opciones estén ocultas
  const notes = item.notes.map((n) => `<div class="sub">* ${esc(n)}</div>`).join("");
  const warn = !withPrices && item.pending ? `<div class="sub">!! SIN EQUIVALENCIA: revisar en el Bridge</div>` : "";
  return `<div class="item">
    <div class="row main${withPrices ? " priced" : ""}"><span class="name">${item.qty}x&nbsp;${esc(item.name)}</span>${withPrices ? `<span class="price">${money(item.price)}</span>` : ""}</div>${parts}${details}${notes}${warn}</div>`;
}

/** Ticket de una estación: encabezado + solo los productos que le tocan. */
export function stationTicketHtml(ticket: DeliveryTicket, station: KitchenStation, settings: BusinessSettings, paper: PaperWidth = 80) {
  const items = ticket.items.filter((i) => i.stations.includes(station));
  return page(
    settings,
    paper,
    `${header(ticket, settings)}
    <div class="station">${esc(station.toUpperCase())}</div>
    ${items.map((i) => itemBlock(i, settings, false, station)).join("")}
    <div class="rule"></div>
    <div class="center meta">${items.reduce((s, i) => s + (i.parts?.some((p) => p.station === station) ? i.parts.filter((p) => p.station === station).reduce((n, p) => n + p.qty, 0) : i.qty), 0)} producto(s) · ${esc(station)}</div>`
  );
}

/** Aclaración con {plataforma} {negocio} {telefono} reemplazados. */
export function noticeText(ticket: DeliveryTicket, settings: BusinessSettings) {
  return settings.ticketNotice
    .replace(/\{plataforma\}/gi, ticket.platform)
    .replace(/\{negocio\}/gi, settings.businessName)
    .replace(/\{telefono\}/gi, settings.ticketPhone || "");
}

/** Ticket del cliente: en delivery el de la bolsa (precios de la plataforma + aclaración); en mostrador, el de la venta. */
export function bagTicketHtml(ticket: DeliveryTicket, settings: BusinessSettings, qrSvg = "", paper: PaperWidth = 80) {
  const charges = ticket.charges.map((c) => `<div class="row"><span class="name">${esc(c.label)}</span><span class="price">${money(c.amount)}</span></div>`).join("");
  return page(
    settings,
    paper,
    `${header(ticket, settings)}
    <div class="rule"></div>
    ${ticket.items.map((i) => itemBlock(i, settings, true)).join("")}
    <div class="rule"></div>
    ${charges}
    ${ticket.total !== null ? `<div class="row total"><span class="name">TOTAL</span><span class="price">${money(ticket.total)}</span></div>` : ""}
    ${ticket.payment ? `<div class="row"><span class="name">Pago</span><span class="price">${esc(ticket.payment)}</span></div>` : ""}
    <div class="rule"></div>
    ${settings.ticketNotice && ticket.kind !== "mostrador" ? `<div class="notice">${esc(noticeText(ticket, settings))}</div>` : ""}
    ${qrSvg ? `<div class="qr">${qrSvg}</div>` : ""}
    ${settings.ticketFooter ? `<div class="center platform" style="margin-top:6px">${esc(settings.ticketFooter)}</div>` : ""}`
  );
}
