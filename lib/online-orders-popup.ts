"use client";
/**
 * Ventana de "llegó un pedido del menú digital" en cualquier pantalla de
 * B-POS. Cada pedido sale una vez por dispositivo (aunque se cambie de
 * pantalla) hasta que le dan "Enterado" o "Ver pedido". También los
 * programados, que antes llegaban sin avisar.
 */
import { kioskLabel, scheduledLabel, scheduledLater, type OnlineOrderData } from "@/lib/digital-menu";

const KEY = "bpos_online_popup"; // de este dispositivo: pedidos avisados y si ya los vieron
export const POPUP_EVENT = "bpos:online-popup";
const KEEP_MS = 2 * 86_400_000;

type Entry = { at: number; done?: boolean };
type PopupSource = { id: string; folio: string; data: OnlineOrderData };

export type OnlinePopupOrder = {
  id: string;
  folio: string;
  label: string;
  name: string;
  total: number;
  /** "dom 15 de nov, 8:30 p.m." si es programado */
  scheduled: string;
  /** Programado que todavía no toca mandar a cocina */
  later: boolean;
  /** Falta poner el costo de envío */
  quote: boolean;
};

function read(): Record<string, Entry> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function write(map: Record<string, Entry>, now = Date.now()) {
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(Object.entries(map).filter(([, e]) => now - e.at < KEEP_MS))));
  } catch {}
}

/** Anota los pedidos que no se habían avisado en este dispositivo */
export function announceNew(pending: Pick<PopupSource, "id">[], now = Date.now()) {
  const map = read();
  let changed = false;
  for (const o of pending) {
    if (!map[o.id]) {
      map[o.id] = { at: now };
      changed = true;
    }
  }
  if (changed) write(map, now);
}

/** Pedidos que siguen esperando y nadie ha visto en este dispositivo */
export function popupOrders(pending: PopupSource[], leadMinutes: number, now = Date.now()): OnlinePopupOrder[] {
  const map = read();
  return pending
    .filter((o) => map[o.id] && !map[o.id].done)
    .map((o) => {
      const d = o.data;
      return {
        id: o.id,
        folio: o.folio,
        label: d.kiosk ? `🖥️ ${kioskLabel(d)}` : d.type === "Domicilio" ? "🛵 Domicilio" : d.type === "Mesa" ? `🍽️ Mesa${d.table ? ` ${d.table}` : ""}` : "🛍️ Recoger",
        name: d.customer?.name || "",
        total: Number(d.total) || 0,
        scheduled: d.scheduledFor ? scheduledLabel(d.scheduledFor) : "",
        later: scheduledLater(d, leadMinutes, now),
        quote: d.type === "Domicilio" && Boolean(d.deliveryQuote),
      };
    });
}

/** "Enterado": ya no sale la ventana de esos pedidos en este dispositivo */
export function dismissPopup(ids: string[], now = Date.now()) {
  const map = read();
  for (const id of ids) map[id] = { at: map[id]?.at || now, done: true };
  write(map, now);
  window.dispatchEvent(new Event(POPUP_EVENT));
}
