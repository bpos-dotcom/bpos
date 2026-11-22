/**
 * ¿Es el mismo pedido o uno nuevo con el mismo número?
 *
 * DiDi reinicia sus números a las 00:00: el #1 de las 4 pm y el #1 de las
 * 00:30 son pedidos distintos aunque el turno siga abierto. Regla:
 *  - DiDi: mismo número el mismo día (hora de México) = el mismo pedido
 *    (reimpresión). Pasando las 00:00 es otro pedido, salvo que llegue a los
 *    pocos minutos con lo mismo (reimpresión justo a medianoche).
 *  - Uber, Rappi y otras: sus códigos no se reinician; el mismo código en
 *    menos de 12 horas es el mismo pedido.
 *
 * Cada pedido se guarda aparte (nunca se borra el anterior para que entre el
 * nuevo): el primero con la llave "plataforma|NÚMERO" y los que repiten
 * número con "plataforma|NÚMERO|AAAAMMDDHHmm" (bridgeKey en sus datos).
 *
 * Este archivo no usa nada del servidor: lo usan la caja y la API. La misma
 * regla está en SQL en bpos_agent_submit_order (migración 0045).
 */

export const BRIDGE_TIME_ZONE = "America/Mexico_City";
/** Reimpresión justo después de medianoche: mismo número y lo mismo, a menos de esto */
export const REPRINT_WINDOW_MS = 30 * 60 * 1000;
/** Plataformas sin números diarios: el mismo código en este tiempo es el mismo pedido */
export const SAME_CODE_WINDOW_MS = 12 * 60 * 60 * 1000;

/** "plataforma|NÚMERO" (sin la parte de repetidos) */
export function baseOrderKey(order: { platform?: unknown; orderId?: unknown }) {
  return `${String(order.platform ?? "").trim().toLowerCase()}|${String(order.orderId ?? "").trim().toUpperCase()}`;
}

/** Llave con la que está guardado el pedido (la de repetidos si la tiene) */
export function orderKey(order: { platform?: unknown; orderId?: unknown; bridgeKey?: unknown }) {
  const base = baseOrderKey(order);
  return validKey(order.bridgeKey, base) || base;
}

/** La llave que mandó una pantalla, solo si es de ese mismo pedido */
export function validKey(key: unknown, base: string) {
  const k = String(key ?? "");
  return k === base || (k.startsWith(`${base}|`) && /^\d{12}$/.test(k.slice(base.length + 1))) ? k : "";
}

/** Fecha y hora en México como "AAAAMMDDHHmm" */
export function mexicoStamp(ms: number) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: BRIDGE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value])
  );
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`;
}

/** Día en México "AAAAMMDD" */
export const mexicoDay = (ms: number) => mexicoStamp(ms).slice(0, 8);

/** Llave para un pedido que repite número */
export const repeatKey = (base: string, ms: number) => `${base}|${mexicoStamp(ms)}`;

export const resetsDaily = (platform: unknown) => String(platform ?? "").toLowerCase().includes("didi");

type Seen = { platform?: unknown; at: number; total?: unknown; items?: unknown };

const sameContent = (a: Seen, b: Seen) => {
  const ta = Number(a.total);
  const tb = Number(b.total);
  const sameTotal = typeof a.total === "number" && typeof b.total === "number" && ta > 0 && Math.abs(ta - tb) < 0.01;
  return sameTotal || JSON.stringify(a.items ?? null) === JSON.stringify(b.items ?? null);
};

/** ¿El que llega (incoming) es el mismo pedido que uno anterior con el mismo número? */
export function isSameOrder(previous: Seen, incoming: Seen) {
  const gap = Math.abs(incoming.at - previous.at);
  if (!resetsDaily(incoming.platform ?? previous.platform)) return gap < SAME_CODE_WINDOW_MS;
  if (mexicoDay(previous.at) === mexicoDay(incoming.at)) return true;
  return gap < REPRINT_WINDOW_MS && sameContent(previous, incoming);
}

/**
 * Venta ya creada para este pedido: con la llave del Bridge si las dos la
 * tienen; si no (ventas de antes), por número y día (DiDi) o 12 horas.
 */
export function isSameSale(sale: { bridgeKey?: unknown; createdAt?: unknown; externalOrderKey?: unknown }, incoming: { bridgeKey?: string; at: number; platform?: unknown }) {
  if (sale.bridgeKey && incoming.bridgeKey) return sale.bridgeKey === incoming.bridgeKey;
  const at = Date.parse(String(sale.createdAt || ""));
  if (!Number.isFinite(at)) return false;
  const platform = incoming.platform ?? String(sale.externalOrderKey || "").split(":")[0];
  if (!resetsDaily(platform)) return Math.abs(incoming.at - at) < SAME_CODE_WINDOW_MS;
  return mexicoDay(at) === mexicoDay(incoming.at);
}
