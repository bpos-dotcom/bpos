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

/** Botón de "Pide donde quieras": prendido y a dónde lleva */
export type ChannelLink = { on: boolean; url: string };

/**
 * Diseño del menú digital (Configuración → Menú digital → Diseño): cada
 * sección se puede apagar; las imágenes son direcciones en la nube.
 */
/** De qué lado van los textos y botones encima de una imagen */
export type Align = "left" | "center" | "right";
/** Colores del menú digital (y del kiosco): claro o oscuro */
export type MenuTheme = "light" | "dark";

export type MenuDesign = {
  theme: MenuTheme;
  topBar: { on: boolean; text: string; city: string };
  hero: { on: boolean; image: string; eyebrow: string; title: string; highlight: string; text: string; badges: string[]; button: string; align: Align };
  featured: { on: boolean; productId: number | null; image: string; eyebrow: string; text: string; badge: string };
  top: { on: boolean; title: string; count: number };
  channels: {
    on: boolean;
    image: string;
    title: string;
    highlight: string;
    text: string;
    align: Align;
    whatsapp: ChannelLink;
    didi: ChannelLink;
    uber: ChannelLink;
    rappi: ChannelLink;
  };
  banner: { on: boolean; image: string; title: string; highlight: string; side: string };
};

export const DEFAULT_DESIGN: MenuDesign = {
  theme: "light",
  topBar: { on: true, text: "", city: "" },
  hero: { on: true, image: "", eyebrow: "", title: "", highlight: "", text: "", badges: ["", "", ""], button: "Ver menú", align: "left" },
  featured: { on: true, productId: null, image: "", eyebrow: "Combo destacado", text: "", badge: "El favorito" },
  top: { on: true, title: "Los más pedidos", count: 5 },
  channels: {
    on: true,
    image: "",
    title: "Pide",
    highlight: "donde quieras",
    text: "",
    align: "left",
    whatsapp: { on: true, url: "" },
    didi: { on: false, url: "" },
    uber: { on: false, url: "" },
    rappi: { on: false, url: "" },
  },
  banner: { on: false, image: "", title: "", highlight: "", side: "" },
};

/** Datos para que el cliente transfiera */
export type BankInfo = { bank: string; clabe: string; holder: string };

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
  /** Envío a cotizar: el cliente pide sin costo de envío y el negocio lo pone al aceptar (viendo el mapa) */
  deliveryQuote: boolean;
  minOrder: number;
  /** Mesas con QR (0 = sin pedidos en mesa) */
  tables: number;
  /** Minutos que se le dicen al cliente al aceptar */
  prepMinutes: number;
  /** Horario para recibir pedidos (sin horario = siempre que esté abierto) */
  hours?: SaleSchedule;
  /** Aviso arriba del menú ("Hoy 2x1 en papas") */
  notice: string;
  /** Pago al recoger o al recibir (forma antigua; ahora manda paymentsByType) */
  payments: { cash: boolean; card: boolean; transfer: boolean };
  /** Formas de pago que acepta cada tipo de pedido */
  paymentsByType: Record<OnlineOrderType, OnlinePayment[]>;
  /** Aceptar solos los pedidos (si hay caja abierta) */
  autoAccept: boolean;
  /** Al cambiar un pedido de estado, abrir WhatsApp con el aviso para el cliente (gratis, wa.me) */
  whatsappNotify: boolean;
  /** Pedidos programados (solo clientes con cuenta): anticipación mínima, días máximos y minutos antes para mandarlos a cocina */
  scheduling: { enabled: boolean; minMinutes: number; maxDays: number; leadMinutes: number };
  /** Liga para dejar reseña en Google (se ofrece a quien califica con 4 o 5 estrellas) */
  googleReviewUrl: string;
  /**
   * Orden de las categorías en el menú digital y en el POS, como lo acomoda
   * el negocio. Las que no estén aquí van después, en el orden del catálogo.
   */
  categoryOrder: string[];
  /** Productos que no se muestran en el menú digital (ids) */
  hidden: number[];
  /** Productos agotados (también se ocultan) */
  soldOut: Record<string, SoldOut>;
  /** WhatsApp del negocio para pedidos (transferencia y botón de WhatsApp), 10 dígitos */
  whatsapp: string;
  bank: BankInfo;
  design: MenuDesign;
};

export const DEFAULT_DIGITAL_MENU: DigitalMenuSettings = {
  enabled: false,
  acceptOrders: true,
  slug: "",
  pickup: true,
  delivery: false,
  deliveryFee: 0,
  deliveryQuote: false,
  minOrder: 0,
  tables: 0,
  prepMinutes: 20,
  notice: "",
  payments: { cash: true, card: true, transfer: false },
  paymentsByType: { Recoger: ["Efectivo", "Tarjeta"], Domicilio: ["Efectivo"], Mesa: ["Efectivo", "Tarjeta"] },
  autoAccept: false,
  whatsappNotify: true,
  scheduling: { enabled: true, minMinutes: 60, maxDays: 3, leadMinutes: 30 },
  googleReviewUrl: "",
  categoryOrder: [],
  hidden: [],
  soldOut: {},
  whatsapp: "",
  bank: { bank: "", clabe: "", holder: "" },
  design: DEFAULT_DESIGN,
};

const str = (value: unknown, fallback: string, max = 200) => (typeof value === "string" ? value.slice(0, max) : fallback);
const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
/** Solo direcciones https (fotos en la nube, ligas de DiDi/Uber/Rappi) */
const url = (value: unknown) => (typeof value === "string" && /^https:\/\/\S+$/i.test(value.trim()) ? value.trim().slice(0, 500) : "");
const align = (value: unknown): Align => (value === "center" || value === "right" ? value : "left");
const channel = (value: unknown, fallback: ChannelLink): ChannelLink => {
  const v = (value || {}) as Partial<ChannelLink>;
  return { on: bool(v.on, fallback.on), url: url(v.url) };
};

export function normalizeDesign(raw: unknown): MenuDesign {
  const r = (raw || {}) as Partial<{ [K in keyof MenuDesign]: Partial<MenuDesign[K]> }>;
  const d = DEFAULT_DESIGN;
  const badges = Array.isArray(r.hero?.badges) ? r.hero.badges : d.hero.badges;
  return {
    theme: r.theme === "dark" ? "dark" : "light",
    topBar: { on: bool(r.topBar?.on, d.topBar.on), text: str(r.topBar?.text, "", 90), city: str(r.topBar?.city, "", 60) },
    hero: {
      on: bool(r.hero?.on, d.hero.on),
      image: url(r.hero?.image),
      eyebrow: str(r.hero?.eyebrow, "", 50),
      title: str(r.hero?.title, "", 40),
      highlight: str(r.hero?.highlight, "", 40),
      text: str(r.hero?.text, "", 200),
      badges: [0, 1, 2].map((i) => str(badges[i], "", 30)),
      button: str(r.hero?.button, d.hero.button, 30) || d.hero.button,
      align: align(r.hero?.align),
    },
    featured: {
      on: bool(r.featured?.on, d.featured.on),
      productId: Number.isFinite(Number(r.featured?.productId)) && r.featured?.productId !== null ? Number(r.featured?.productId) : null,
      image: url(r.featured?.image),
      eyebrow: str(r.featured?.eyebrow, d.featured.eyebrow, 40),
      text: str(r.featured?.text, "", 200),
      badge: str(r.featured?.badge, d.featured.badge, 30),
    },
    top: {
      on: bool(r.top?.on, d.top.on),
      title: str(r.top?.title, d.top.title, 40) || d.top.title,
      count: Math.round(num(r.top?.count, d.top.count, 3, 10)),
    },
    channels: {
      on: bool(r.channels?.on, d.channels.on),
      image: url(r.channels?.image),
      title: str(r.channels?.title, d.channels.title, 30),
      highlight: str(r.channels?.highlight, d.channels.highlight, 30),
      text: str(r.channels?.text, "", 120),
      align: align(r.channels?.align),
      whatsapp: channel(r.channels?.whatsapp, d.channels.whatsapp),
      didi: channel(r.channels?.didi, d.channels.didi),
      uber: channel(r.channels?.uber, d.channels.uber),
      rappi: channel(r.channels?.rappi, d.channels.rappi),
    },
    banner: {
      on: bool(r.banner?.on, d.banner.on),
      image: url(r.banner?.image),
      title: str(r.banner?.title, "", 40),
      highlight: str(r.banner?.highlight, "", 40),
      side: str(r.banner?.side, "", 60),
    },
  };
}

/** "Mercado Pago": el cliente paga en línea al pedir, con la cuenta que vinculó el negocio */
export const ONLINE_PAYMENTS = ["Efectivo", "Tarjeta", "Transferencia", "Mercado Pago"] as const;
export type OnlinePayment = (typeof ONLINE_PAYMENTS)[number];
const ORDER_TYPES = ["Recoger", "Domicilio", "Mesa"] as const;

/** Formas de pago por tipo de pedido; sin configurar, las de antes para todos. */
function normalizePaymentsByType(raw: unknown, old?: Partial<DigitalMenuSettings["payments"]>): Record<OnlineOrderType, OnlinePayment[]> {
  const legacy: OnlinePayment[] = [
    ...(old?.cash !== false ? (["Efectivo"] as const) : []),
    ...(old?.card !== false ? (["Tarjeta"] as const) : []),
    ...(old?.transfer === true ? (["Transferencia"] as const) : []),
  ];
  const r = (raw || {}) as Partial<Record<OnlineOrderType, unknown>>;
  return Object.fromEntries(
    ORDER_TYPES.map((t) => {
      const list = Array.isArray(r[t]) ? (r[t] as unknown[]).filter((p): p is OnlinePayment => (ONLINE_PAYMENTS as readonly unknown[]).includes(p)) : null;
      return [t, list ?? (raw ? [] : legacy.length ? legacy : ["Efectivo"])];
    })
  ) as Record<OnlineOrderType, OnlinePayment[]>;
}

/** "8711234567" → "528711234567" para wa.me ("" si no es un número válido) */
export function whatsappNumber(value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `52${digits}`;
  if (digits.length === 12 && digits.startsWith("52")) return digits;
  if (digits.length === 13 && digits.startsWith("521")) return `52${digits.slice(3)}`;
  return "";
}

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
    deliveryQuote: r.deliveryQuote === true,
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
    paymentsByType: normalizePaymentsByType(r.paymentsByType, r.payments),
    autoAccept: r.autoAccept === true,
    whatsappNotify: r.whatsappNotify !== false,
    scheduling: {
      enabled: r.scheduling?.enabled !== false,
      minMinutes: Math.round(num(r.scheduling?.minMinutes, 60, 15, 24 * 60)),
      maxDays: Math.round(num(r.scheduling?.maxDays, 3, 0, 14)),
      leadMinutes: Math.round(num(r.scheduling?.leadMinutes, 30, 5, 180)),
    },
    googleReviewUrl: /^https:\/\/\S+$/i.test(String(r.googleReviewUrl || "").trim()) ? String(r.googleReviewUrl).trim().slice(0, 300) : "",
    categoryOrder: Array.isArray(r.categoryOrder)
      ? Array.from(new Set(r.categoryOrder.filter((c): c is string => typeof c === "string").map((c) => c.trim().slice(0, 60)).filter(Boolean))).slice(0, 100)
      : [],
    hidden: Array.isArray(r.hidden) ? r.hidden.map(Number).filter(Number.isFinite) : [],
    soldOut,
    whatsapp: String(r.whatsapp || "").replace(/\D/g, "").slice(0, 13),
    bank: {
      bank: str(r.bank?.bank, "", 40),
      clabe: String(r.bank?.clabe || "").replace(/\D/g, "").slice(0, 18),
      holder: str(r.bank?.holder, "", 80),
    },
    design: normalizeDesign(r.design),
  };
}

/**
 * Acomoda las categorías según el orden del negocio: primero las del orden
 * guardado (en ese orden), después las demás como vienen del catálogo.
 */
export function sortCategories(categories: string[], order: string[]): string[] {
  const rank = new Map(order.map((c, i) => [c, i]));
  return [...categories].sort((a, b) => {
    const ra = rank.get(a);
    const rb = rank.get(b);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return 0; // sort es estable: conservan el orden del catálogo
  });
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
  customer: { name: string; phone: string; address: string; reference: string; location?: { lat: number; lng: number } };
  payment: OnlinePayment;
  /** Pago en línea con Mercado Pago (lo escribe solo el servidor de B-POS al confirmar el pago) */
  mp?: OnlineMpPayment;
  /** Con cuánto paga (efectivo, para llevar cambio) */
  cashWith?: number;
  note: string;
  lines: OnlineOrderLine[];
  subtotal: number;
  deliveryFee: number;
  /** El envío se cotiza al aceptar: deliveryFee y total se actualizan cuando el negocio lo pone */
  deliveryQuote?: boolean;
  /** Pedido programado: cuándo lo quiere (ISO). Sin esto, lo antes posible */
  scheduledFor?: string;
  /**
   * Pedido hecho en el kiosco del local (pantalla táctil): para comer aquí o
   * para llevar, qué pantalla, y la orden de cobro en la terminal Point.
   */
  kiosk?: { eat: KioskEat; screen: string; chargeId?: string };
  /** Cupón que escribió el cliente y el descuento que vio */
  coupon?: { code: string; discount: number };
  total: number;
};

export type OnlineMpPayment = {
  status: "approved" | "refunded";
  paymentId: string;
  amount: number;
  paidAt: string;
  refundedAt?: string;
};

/** Eligió pagar con Mercado Pago y todavía no paga: el negocio no lo ve como pedido nuevo */
export function awaitingOnlinePayment(d: Pick<OnlineOrderData, "payment" | "mp">) {
  return d.payment === "Mercado Pago" && !d.mp;
}

/** Ya pagado en línea (Mercado Pago aprobado, sin devolver) */
export function paidOnline(d: Pick<OnlineOrderData, "payment" | "mp">) {
  return d.payment === "Mercado Pago" && d.mp?.status === "approved";
}

export type KioskEat = "aqui" | "llevar";

/** "Kiosco · Para comer aquí" / "Kiosco · Para llevar" ("" si no es del kiosco) */
export function kioskLabel(d: Pick<OnlineOrderData, "kiosk">) {
  if (!d.kiosk) return "";
  return `Kiosco · ${d.kiosk.eat === "aqui" ? "Para comer aquí" : "Para llevar"}`;
}

/** "vie 31 oct, 8:00 p.m." */
export function scheduledLabel(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" })}, ${d.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" })}`;
}

/** Pedido programado que todavía no toca mandar a cocina */
export function scheduledLater(d: Pick<OnlineOrderData, "scheduledFor">, leadMinutes: number, now = Date.now()) {
  return Boolean(d.scheduledFor && Date.parse(d.scheduledFor) - leadMinutes * 60000 > now);
}

/** Liga de Google Maps de la ubicación que compartió el cliente */
export function mapsLink(location?: { lat: number; lng: number }) {
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return "";
  return `https://maps.google.com/?q=${location.lat.toFixed(6)},${location.lng.toFixed(6)}`;
}

/** Mensaje de WhatsApp con el desglose del pedido (pago por transferencia o para avisar al negocio). */
export function orderWhatsappText(businessName: string, folio: string, d: OnlineOrderData) {
  const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;
  const lines = d.lines.map((l) => {
    const extra = [l.summary, l.comment ? `"${l.comment}"` : ""].filter(Boolean).join(" · ");
    return `• ${l.quantity} × ${l.name}${extra ? ` (${extra})` : ""} ${money(l.unitPrice * l.quantity)}`;
  });
  const where =
    d.type === "Domicilio"
      ? [`🛵 A domicilio: ${d.customer.address}${d.customer.reference ? ` (${d.customer.reference})` : ""}`, mapsLink(d.customer.location) ? `📍 Ubicación: ${mapsLink(d.customer.location)}` : ""]
      : d.type === "Mesa"
        ? [`🍽️ Mesa ${d.table}`]
        : ["🛍️ Paso a recoger"];
  return [
    `🧾 *Pedido ${folio} · ${businessName}*`,
    `Cliente: ${d.customer.name}${d.customer.phone ? ` · ${d.customer.phone}` : ""}`,
    "",
    ...lines,
    d.deliveryFee ? `Envío ${money(d.deliveryFee)}${paidOnline(d) ? " (se paga al repartidor)" : ""}` : d.deliveryQuote ? "Envío: por cotizar" : "",
    d.coupon ? `Cupón ${d.coupon.code} -${money(d.coupon.discount)}` : "",
    `*Total ${money(d.total)}${d.deliveryQuote && !d.deliveryFee ? " + envío" : ""}*`,
    "",
    ...where,
    d.scheduledFor ? `📅 Programado para ${scheduledLabel(d.scheduledFor)}` : "",
    `💳 Pago: ${d.payment}${d.payment === "Transferencia" ? " · te envío el comprobante" : paidOnline(d) ? " · ya pagado en línea" : ""}`,
    d.note ? `📝 ${d.note}` : "",
  ]
    .filter((l, i, all) => l !== "" || (all[i - 1] !== "" && i > 0))
    .join("\n");
}
