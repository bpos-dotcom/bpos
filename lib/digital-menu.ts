/**
 * Menú digital (Configuración → Menú digital) de ESTA sucursal: si el menú
 * está publicado, si recibe pedidos, cómo (recoger, domicilio, mesa), su
 * horario y qué productos no se muestran (ocultos o agotados).
 *
 * Se guarda en localStorage "bpos_digital_menu" y la sincronización lo sube
 * a la nube por sucursal; de ahí lo lee la página pública /m/<liga>.
 * Lo usan la página pública y B-POS, así que no depende del navegador.
 */
import type { ModifierGroup, Product } from "@/data/products";
import { isOnSale, type SaleSchedule } from "@/lib/sale-schedule";

export const DIGITAL_MENU_KEY = "bpos_digital_menu";
export const DIGITAL_MENU_EVENT = "bpos:digital-menu-updated";

export type SoldOut = {
  /** Fin del agotado (ISO) o null = hasta que se vuelva a activar */
  until: string | null;
  at: string;
};

export type DigitalMenuSettings = {
  /** El menú se ve en la liga pública */
  enabled: boolean;
  /** Además de verse, recibe pedidos */
  acceptOrders: boolean;
  /** Liga pública (bpos.com.mx/m/<slug>); se reserva en la nube */
  slug: string;
  pickup: boolean;
  delivery: boolean;
  deliveryFee: number;
  minOrder: number;
  /** Mesas con QR (0 = sin pedidos en mesa) */
  tables: number;
  /** Minutos que se le dicen al cliente al aceptar */
  prepMinutes: number;
  /** Horario para recibir pedidos (sin horario = siempre que esté abierto) */
  hours?: SaleSchedule;
  /** Aviso arriba del menú ("Hoy 2x1 en papas") */
  notice: string;
  /** Pago al recoger o al recibir */
  payments: { cash: boolean; card: boolean; transfer: boolean };
  /** Aceptar solos los pedidos (si hay caja abierta) */
  autoAccept: boolean;
  /** Productos que no se muestran en el menú digital (ids) */
  hidden: number[];
  /** Productos agotados (también se ocultan) */
  soldOut: Record<string, SoldOut>;
};

export const DEFAULT_DIGITAL_MENU: DigitalMenuSettings = {
  enabled: false,
  acceptOrders: true,
  slug: "",
  pickup: true,
  delivery: false,
  deliveryFee: 0,
  minOrder: 0,
  tables: 0,
  prepMinutes: 20,
  notice: "",
  payments: { cash: true, card: true, transfer: false },
  autoAccept: false,
  hidden: [],
  soldOut: {},
};

const num = (value: unknown, fallback: number, min = 0, max = 100000) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function normalizeDigitalMenu(raw: Partial<DigitalMenuSettings> | null | undefined): DigitalMenuSettings {
  const r = raw || {};
  const soldOut: Record<string, SoldOut> = {};
  Object.entries(r.soldOut || {}).forEach(([id, s]) => {
    if (s && typeof s === "object") soldOut[id] = { until: typeof s.until === "string" ? s.until : null, at: String(s.at || "") };
  });
  return {
    enabled: r.enabled === true,
    acceptOrders: r.acceptOrders !== false,
    slug: typeof r.slug === "string" ? r.slug : "",
    pickup: r.pickup !== false,
    delivery: r.delivery === true,
    deliveryFee: num(r.deliveryFee, 0),
    minOrder: num(r.minOrder, 0),
    tables: Math.round(num(r.tables, 0, 0, 200)),
    prepMinutes: Math.round(num(r.prepMinutes, 20, 5, 240)),
    hours: r.hours,
    notice: typeof r.notice === "string" ? r.notice.slice(0, 200) : "",
    payments: {
      cash: r.payments?.cash !== false,
      card: r.payments?.card !== false,
      transfer: r.payments?.transfer === true,
    },
    autoAccept: r.autoAccept === true,
    hidden: Array.isArray(r.hidden) ? r.hidden.map(Number).filter(Number.isFinite) : [],
    soldOut,
  };
}

export function getDigitalMenu(): DigitalMenuSettings {
  if (typeof window === "undefined") return DEFAULT_DIGITAL_MENU;
  try {
    return normalizeDigitalMenu(JSON.parse(localStorage.getItem(DIGITAL_MENU_KEY) || "null"));
  } catch {
    return DEFAULT_DIGITAL_MENU;
  }
}

export function saveDigitalMenu(patch: Partial<DigitalMenuSettings>) {
  const next = normalizeDigitalMenu({ ...getDigitalMenu(), ...patch });
  localStorage.setItem(DIGITAL_MENU_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(DIGITAL_MENU_EVENT, { detail: next }));
  return next;
}

/** Fin del día de hoy (para "Agotado solo hoy"). */
export function endOfToday(now = new Date()) {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end.toISOString();
}

export function isSoldOut(menu: Pick<DigitalMenuSettings, "soldOut">, productId: number, now = new Date()) {
  const s = menu.soldOut[String(productId)];
  if (!s) return false;
  return s.until === null || Date.parse(s.until) > now.getTime();
}

/** ¿El cliente puede ver y pedir este producto? */
export function isAvailableOnline(menu: Pick<DigitalMenuSettings, "soldOut" | "hidden">, product: Product, now = new Date()) {
  return !menu.hidden.includes(Number(product.id)) && !isSoldOut(menu, product.id, now) && isOnSale(product.saleSchedule, now);
}

/**
 * Opciones de un producto sin las que enlazan a un producto agotado u
 * oculto ("Coca-Cola" agotada dentro del combo). Un grupo obligatorio que
 * se queda sin opciones deja al producto sin poder pedirse.
 */
export function onlineGroups(product: Product, catalog: Product[], menu: Pick<DigitalMenuSettings, "soldOut" | "hidden">, now = new Date()) {
  const byId = new Map(catalog.map((p) => [Number(p.id), p]));
  const groups: ModifierGroup[] = (product.modifierGroups || []).map((g) => ({
    ...g,
    options: g.options.filter((o) => {
      if (!o.productId) return true;
      const linked = byId.get(Number(o.productId));
      return Boolean(linked) && !isSoldOut(menu, Number(o.productId), now);
    }),
  }));
  const blocked = groups.some((g) => g.min > 0 && g.options.length === 0);
  return { groups, blocked };
}

/** ¿Recibe pedidos en este momento? (horario) */
export function isOpenNow(menu: Pick<DigitalMenuSettings, "hours">, now = new Date()) {
  return isOnSale(menu.hours, now);
}

/** Liga sugerida a partir del nombre del negocio: "Burger Planet" → "burger-planet" */
export function suggestSlug(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/;

// ------------------------------------------------------------ pedido del cliente

/** Lo que el cliente eligió de un producto (mismas elecciones que en el POS). */
export type OnlineOrderLine = {
  productId: number;
  name: string;
  quantity: number;
  /** Precio por pieza que vio el cliente (producto + extras) */
  unitPrice: number;
  /** dueño → grupo → opciones (como en el POS: "__producto" y "p:<id>") */
  picks: Record<string, Record<string, string[]>>;
  /** Texto de lo elegido para mostrar ("Aderezo: Ranch · Refresco: Coca") */
  summary: string;
  comment?: string;
};

export type OnlineOrderType = "Recoger" | "Domicilio" | "Mesa";

export type OnlineOrderData = {
  type: OnlineOrderType;
  table?: string;
  customer: { name: string; phone: string; address: string; reference: string };
  payment: "Efectivo" | "Tarjeta" | "Transferencia";
  /** Con cuánto paga (efectivo, para llevar cambio) */
  cashWith?: number;
  note: string;
  lines: OnlineOrderLine[];
  subtotal: number;
  deliveryFee: number;
  total: number;
};
