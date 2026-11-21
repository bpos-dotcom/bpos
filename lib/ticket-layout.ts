/**
 * Configurador de tickets: qué sale arriba de cada ticket según de dónde
 * viene el pedido (DiDi, Uber, Rappi o el local). Cada negocio lo elige en
 * Configuración → Empresa → Configurador de tickets.
 *
 * Ejemplo: en DiDi el repartidor pide "el número 4" (recuadro = número) y en
 * Uber pide "el de Daniel A." (recuadro = nombre del cliente).
 */
export type TicketLayoutKind = "didi" | "uber" | "rappi" | "local";
/** Arriba del ticket: logo, nombre del negocio, texto propio o nada */
export type TicketTop = "logo" | "name" | "text" | "none";
/** Lo que va en el recuadro grande o en el renglón de "Delivery" */
export type TicketField = "number" | "customer" | "none";

/** QR del ticket del cliente: el general (Tickets de delivery), otro link propio de este tipo, o ninguno */
export type TicketQrMode = "general" | "custom" | "none";

export type TicketLayout = { top: TicketTop; topText: string; box: TicketField; beside: TicketField; qr: TicketQrMode; qrText: string; qrCaption: string };
export type TicketLayouts = Record<TicketLayoutKind, TicketLayout>;

export const TICKET_LAYOUT_KINDS: { kind: TicketLayoutKind; label: string }[] = [
  { kind: "didi", label: "DiDi Food" },
  { kind: "uber", label: "Uber Eats" },
  { kind: "rappi", label: "Rappi y otras" },
  { kind: "local", label: "Local" },
];

export const DEFAULT_TICKET_LAYOUTS: TicketLayouts = {
  didi: { top: "logo", topText: "", box: "number", beside: "customer", qr: "general", qrText: "", qrCaption: "" },
  uber: { top: "logo", topText: "", box: "customer", beside: "number", qr: "general", qrText: "", qrCaption: "" },
  rappi: { top: "logo", topText: "", box: "number", beside: "customer", qr: "general", qrText: "", qrCaption: "" },
  local: { top: "logo", topText: "", box: "none", beside: "customer", qr: "general", qrText: "", qrCaption: "" },
};

const TOPS: TicketTop[] = ["logo", "name", "text", "none"];
const FIELDS: TicketField[] = ["number", "customer", "none"];
const QR_MODES: TicketQrMode[] = ["general", "custom", "none"];

/** Lo guardado (puede venir incompleto o de una versión anterior) → configuración completa */
export function normalizeTicketLayouts(raw: unknown): TicketLayouts {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<TicketLayoutKind, Partial<TicketLayout>>>;
  const out = {} as TicketLayouts;
  for (const { kind } of TICKET_LAYOUT_KINDS) {
    const d = DEFAULT_TICKET_LAYOUTS[kind];
    const v = r[kind] || {};
    out[kind] = {
      top: TOPS.includes(v.top as TicketTop) ? (v.top as TicketTop) : d.top,
      topText: typeof v.topText === "string" ? v.topText.slice(0, 80) : d.topText,
      box: FIELDS.includes(v.box as TicketField) ? (v.box as TicketField) : d.box,
      beside: FIELDS.includes(v.beside as TicketField) ? (v.beside as TicketField) : d.beside,
      qr: QR_MODES.includes(v.qr as TicketQrMode) ? (v.qr as TicketQrMode) : d.qr,
      qrText: typeof v.qrText === "string" ? v.qrText.trim().slice(0, 500) : d.qrText,
      qrCaption: typeof v.qrCaption === "string" ? v.qrCaption.slice(0, 80) : d.qrCaption,
    };
  }
  return out;
}

/** De qué tipo es el ticket: mostrador/mesa/kiosco/en línea = local; las plataformas por su nombre */
export function ticketLayoutKind(ticket: { kind?: string; platform: string }): TicketLayoutKind {
  if (ticket.kind === "mostrador") return "local";
  const p = ticket.platform.toLowerCase();
  if (p.includes("didi")) return "didi";
  if (p.includes("uber")) return "uber";
  return "rappi";
}

/** QR que lleva el ticket del cliente de este tipo: link y texto de abajo ("" = sin QR) */
export function ticketQrFor(
  ticket: { kind?: string; platform: string },
  settings: { ticketQrText: string; ticketQrCaption: string; ticketLayouts?: unknown }
): { text: string; caption: string } {
  const layout = normalizeTicketLayouts(settings.ticketLayouts)[ticketLayoutKind(ticket)];
  if (layout.qr === "none") return { text: "", caption: "" };
  if (layout.qr === "custom") return { text: layout.qrText.trim(), caption: layout.qrCaption.trim() };
  return { text: settings.ticketQrText.trim(), caption: settings.ticketQrCaption.trim() };
}
