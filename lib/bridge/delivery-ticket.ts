import type { KitchenStation } from "@/data/products";
import type { LineRouting } from "@/lib/bridge/station-routing";

/**
 * Pedido de delivery ya leído, listo para los tickets propios de Burger
 * Planet (uno por estación con solo lo suyo, y el de la bolsa con precios).
 *
 * Se arma del texto del ticket original (renglones "1x Producto MX$129.99")
 * y de las equivalencias del Bridge (qué estación lleva cada renglón).
 */
export type TicketChoice = { qty: number; name: string; price: number | null; question?: string };

export type TicketItem = {
  index: number; // renglón en el texto del ticket (el mismo sourceIndex del Bridge)
  qty: number;
  name: string;
  price: number | null;
  choices: TicketChoice[];
  notes: string[];
  stations: KitchenStation[];
  pending: boolean; // algún renglón sin equivalencia
};

export type DeliveryTicket = {
  /** delivery: pedido de plataforma; mostrador: venta del POS (sin aclaración de repartidores) */
  kind?: "delivery" | "mostrador";
  platform: string; // "DiDi Food", "Uber Eats", "Rappi" o el tipo de venta del POS ("Mostrador"...)
  orderId: string;
  customer: string | null;
  receivedAt: string;
  items: TicketItem[];
  charges: { label: string; amount: number }[];
  total: number | null;
  payment?: string; // método de pago (ventas del POS)
};

const QUANTIFIED = /^\s*(\d{1,4})\s*[xX×]\s*(.+?)\s*$/;
const TRAILING_MONEY = /\s*(-?)\s*(?:MX\$|\$)\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(?:MXN)?\s*$/i;
const CHARGE = /^(sub\s*total|total(?:\s+a\s+pagar|\s+pagado)?|dto\.?\s+de\s+producto|descuento[^$]*|promoci[oó]n[^$]*|tarifa\s+de\s+(?:entrega|servicio)|costo\s+de\s+env[ií]o|env[ií]o|propina|cargo[^$]*)\s*[:\-]?\s*-?\s*(?:MX\$|\$)/i;
const NOTE = /^(sin|con|extra|poco|mucho|bien|t[eé]rmino|nota|notas|por favor|aparte)\b/i;
const END_OF_ITEMS = /^(pago\s+(?:de|en|con)\b|hora\s+de|m[eé]todo\s+de\s+pago|forma\s+de\s+pago)/i;

function splitPrice(text: string): { text: string; price: number | null } {
  const match = text.match(TRAILING_MONEY);
  if (!match) return { text: text.trim(), price: null };
  const amount = Number(match[2].replace(/,/g, ""));
  return { text: text.slice(0, match.index).trim().replace(/[.\s]+$/, ""), price: match[1] ? -amount : amount };
}

export function platformLabel(platform: string | undefined) {
  const p = String(platform || "").toLowerCase();
  if (p.includes("didi")) return "DiDi Food";
  if (p.includes("uber")) return "Uber Eats";
  if (p.includes("rappi")) return "Rappi";
  return "Delivery";
}

export function buildDeliveryTicket(
  order: { platform?: string; orderId?: string | null; rawText?: string; receivedAt?: string; bridgeReceivedAt?: string; total?: number; customer?: { name?: string | null } },
  routing: Map<number, LineRouting>
): DeliveryTicket {
  const items: TicketItem[] = [];
  const charges: { label: string; amount: number }[] = [];
  let current: TicketItem | null = null;
  let question: string | null = null; // texto suelto pendiente: encabezado de grupo o nota
  let lastQuestion: string | null = null; // último encabezado (para opciones seguidas)
  let inCharges = false;

  const lines = String(order.rawText || "").replace(/\r/g, "").split("\n");
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;

    // Cargos y cierre solo cuentan después del primer producto: DiDi a veces pone
    // "Hora de Aceptación de Pedido" arriba y cortaba la lectura antes de los productos
    if (items.length && CHARGE.test(line)) {
      inCharges = true;
      const { text, price } = splitPrice(line);
      if (price !== null) charges.push({ label: text.replace(/\s*[:\-]$/, ""), amount: price });
      return;
    }
    if (inCharges || (items.length && END_OF_ITEMS.test(line))) {
      inCharges = true;
      return;
    }

    const quantified = line.match(QUANTIFIED);
    if (quantified) {
      const { text, price } = splitPrice(quantified[2]);
      const route = routing.get(index);
      // Opción del producto anterior: viene después de un encabezado de grupo
      // ("Elige el aderezo:" → "1x BBQ"), o cuesta $0 aunque no tenga encabezado
      // ("1x Bluecheese No, Gracias MX$0.00"). Una línea con precio y sin
      // encabezado es un producto nuevo.
      if (current && (question !== null || !price)) {
        current.choices.push({ qty: Number(quantified[1]), name: text, price, question: question || lastQuestion || undefined });
        route?.stations.forEach((s) => current!.stations.includes(s) || current!.stations.push(s));
        if (route?.pending) current.pending = true;
        if (question !== null) lastQuestion = question;
        question = null;
        return;
      }
      if (current && question) current.notes.push(question); // texto suelto antes de un producto nuevo: nota
      current = {
        index,
        qty: Number(quantified[1]),
        name: text,
        price,
        choices: [],
        notes: [],
        stations: route ? [...route.stations] : [],
        pending: Boolean(route?.pending),
      };
      items.push(current);
      question = null;
      lastQuestion = null;
      return;
    }

    if (!current) return; // encabezado: plataforma, dirección, notas generales
    if (!/[a-záéíóúñ]/i.test(line) || TRAILING_MONEY.test(line)) return;
    const text = line.replace(/\s+/g, " ");
    // Indicación de cocina ("Sin cebolla", "Extra queso"): siempre es nota
    if (NOTE.test(text)) {
      current.notes.push(text);
      return;
    }
    // Texto suelto: encabezado de grupo si le sigue una opción; si no, nota
    if (question) current.notes.push(question);
    question = text;
  });
  if (current && question) (current as TicketItem).notes.push(question);

  // Renglón que el Bridge no conoce y nadie ignoró: a Cocina, para que se prepare
  items.forEach((item) => {
    const allIgnored = [item.index].every((i) => routing.get(i)?.ignored);
    if (!item.stations.length && !allIgnored) item.stations.push("Cocina");
  });

  const totalCharge = [...charges].reverse().find((c) => /^total/i.test(c.label));
  return {
    kind: "delivery",
    platform: platformLabel(order.platform),
    orderId: String(order.orderId || ""),
    customer: order.customer?.name?.trim() || null,
    receivedAt: order.bridgeReceivedAt || order.receivedAt || new Date().toISOString(),
    items,
    charges: charges.filter((c) => !/^total/i.test(c.label)),
    total: totalCharge ? totalCharge.amount : typeof order.total === "number" && order.total > 0 ? order.total : null,
  };
}

/** Estaciones que reciben ticket (en el orden de la cocina). */
export function ticketStations(ticket: DeliveryTicket): KitchenStation[] {
  const order: KitchenStation[] = ["Parrilla", "Freidora", "Barra", "Cocina"];
  const used = new Set(ticket.items.flatMap((i) => i.stations));
  return order.filter((s) => used.has(s));
}
