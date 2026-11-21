/**
 * Promociones del menú digital (Configuración → Menú digital → Promociones).
 *
 * A diferencia de los cupones, el cliente no escribe nada: la promoción se
 * aplica sola en su carrito si le toca. Cada una tiene un tipo (descuento en
 * %, en pesos, 2x1 en ciertos productos o envío gratis) y para quién es
 * (todos, solo clientes nuevos —su primera compra— o solo socios del club).
 *
 * Se guardan dentro de la configuración del menú digital (bpos_digital_menu),
 * así que la página pública las lee igual que el resto del menú. Al aceptar
 * el pedido, B-POS las vuelve a calcular con sus precios y revisa que el
 * cliente de verdad sea nuevo o del club.
 *
 * No se juntan entre sí ni con un cupón: se usa la que más le ahorra.
 */

export type PromoKind = "percent" | "amount" | "2x1" | "freeShipping";
export type PromoAudience = "all" | "new" | "club";

export type Promotion = {
  id: string;
  /** Lo que ve el cliente ("10% en tu primera compra"); vacío = se arma solo */
  name: string;
  kind: PromoKind;
  /** % o pesos (en 2x1 y envío gratis no se usa) */
  value: number;
  /** Compra mínima (0 = cualquiera) */
  minPurchase: number;
  /** Tope de descuento para % (0 = sin tope) */
  maxDiscount: number;
  audience: PromoAudience;
  /** 2x1: en qué productos o categorías (vacío los dos = en todo el menú) */
  productIds: number[];
  categories: string[];
  /** Vigencia "AAAA-MM-DD" ("" = sin fecha) */
  from: string;
  until: string;
  active: boolean;
};

export const PROMO_KINDS: { kind: PromoKind; label: string; hint: string }[] = [
  { kind: "percent", label: "Descuento en %", hint: "Ej. 10% en toda la compra" },
  { kind: "amount", label: "Descuento en pesos", hint: "Ej. $50 menos en la compra" },
  { kind: "2x1", label: "2x1", hint: "En los productos o categorías que elijas: de cada dos, el más barato va gratis" },
  { kind: "freeShipping", label: "Envío gratis", hint: "Solo en pedidos a domicilio" },
];

export const PROMO_AUDIENCES: { audience: PromoAudience; label: string; hint: string }[] = [
  { audience: "all", label: "Todos los clientes", hint: "Cualquiera que pida en el menú digital" },
  { audience: "new", label: "Solo clientes nuevos", hint: "Su primera compra: nunca han pedido con ese teléfono" },
  { audience: "club", label: "Solo socios del club", hint: "Entran a su cuenta y ya son del club" },
];

const round = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown, min = 0, max = 1_000_000) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0;
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function newPromotion(): Promotion {
  return {
    id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: "",
    kind: "percent",
    value: 10,
    minPurchase: 0,
    maxDiscount: 0,
    audience: "new",
    productIds: [],
    categories: [],
    from: "",
    until: "",
    active: true,
  };
}

function normalizePromotion(raw: unknown): Promotion | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Promotion>;
  const id = typeof r.id === "string" ? r.id.slice(0, 40) : "";
  if (!id) return null;
  const kind: PromoKind = PROMO_KINDS.some((k) => k.kind === r.kind) ? (r.kind as PromoKind) : "percent";
  const audience: PromoAudience = PROMO_AUDIENCES.some((a) => a.audience === r.audience) ? (r.audience as PromoAudience) : "all";
  return {
    id,
    name: typeof r.name === "string" ? r.name.slice(0, 60) : "",
    kind,
    value: kind === "percent" ? num(r.value, 0, 100) : num(r.value),
    minPurchase: num(r.minPurchase),
    maxDiscount: num(r.maxDiscount),
    audience,
    productIds: Array.isArray(r.productIds) ? Array.from(new Set(r.productIds.map(Number).filter(Number.isFinite))).slice(0, 300) : [],
    categories: Array.isArray(r.categories) ? Array.from(new Set(r.categories.filter((c): c is string => typeof c === "string").map((c) => c.trim().slice(0, 60)).filter(Boolean))).slice(0, 60) : [],
    from: DAY.test(String(r.from || "")) ? String(r.from) : "",
    until: DAY.test(String(r.until || "")) ? String(r.until) : "",
    active: r.active !== false,
  };
}

export function normalizePromotions(raw: unknown): Promotion[] {
  return Array.isArray(raw) ? raw.map(normalizePromotion).filter((p): p is Promotion => Boolean(p)).slice(0, 30) : [];
}

/** Revisa lo que el negocio escribió antes de guardar ("" = bien) */
export function promotionError(p: Promotion): string {
  if ((p.kind === "percent" || p.kind === "amount") && !(p.value > 0)) return "Escribe el descuento.";
  if (p.kind === "percent" && p.value > 100) return "El descuento no puede ser más de 100%.";
  if (p.from && p.until && p.from > p.until) return "La fecha de inicio es después de la de fin.";
  return "";
}

const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

/** "10% de descuento en tu primera compra" (lo que ve el cliente) */
export function promoLabel(p: Promotion): string {
  if (p.name.trim()) return p.name.trim();
  const what =
    p.kind === "percent"
      ? `${p.value}% de descuento`
      : p.kind === "amount"
        ? `${money(p.value)} de descuento`
        : p.kind === "2x1"
          ? `2x1${p.categories.length ? ` en ${p.categories.join(", ")}` : p.productIds.length ? " en productos seleccionados" : ""}`
          : "Envío gratis";
  const who = p.audience === "new" ? " en tu primera compra" : p.audience === "club" ? " para socios del club" : "";
  const min = p.minPurchase > 0 ? ` (compras desde ${money(p.minPurchase)})` : "";
  return `${what}${who}${min}`;
}

/** Fecha local "AAAA-MM-DD" */
const today = (now: Date) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

/** Estado hoy (para la lista del negocio) */
export function promoState(p: Promotion, now = new Date()): "activa" | "pausada" | "por empezar" | "vencida" {
  const day = today(now);
  if (!p.active) return "pausada";
  if (p.until && day > p.until) return "vencida";
  if (p.from && day < p.from) return "por empezar";
  return "activa";
}

/** Lo que importa de cada renglón del carrito para las promociones */
export type PromoLine = { productId: number; category: string; unitPrice: number; quantity: number };

/** ¿El 2x1 aplica a este renglón? */
function inPromo(p: Promotion, line: PromoLine) {
  if (!p.productIds.length && !p.categories.length) return true;
  return p.productIds.includes(Number(line.productId)) || p.categories.includes(line.category);
}

/** 2x1: de cada dos piezas que entran en la promoción, la más barata va gratis */
function twoForOne(p: Promotion, lines: PromoLine[]) {
  const prices: number[] = [];
  for (const l of lines) {
    if (!inPromo(p, l)) continue;
    const q = Math.max(0, Math.min(200, Math.floor(Number(l.quantity) || 0)));
    for (let i = 0; i < q; i += 1) prices.push(Math.max(0, Number(l.unitPrice) || 0));
  }
  prices.sort((a, b) => b - a);
  let free = 0;
  for (let i = 1; i < prices.length; i += 2) free += prices[i];
  return free;
}

export type PromoContext = {
  lines: PromoLine[];
  subtotal: number;
  /** Pedido a domicilio (envío gratis solo aplica aquí) */
  delivery: boolean;
  /** Costo de envío que pagaría (0 si se cotiza después) */
  deliveryFee: number;
  /** Nunca ha pedido con ese teléfono */
  isNew: boolean;
  /** Entró a su cuenta y es socio del club */
  isClub: boolean;
  now?: Date;
};

export type PromoResult = {
  promo: Promotion;
  /** Descuento en productos */
  discount: number;
  /** No se cobra envío */
  freeShipping: boolean;
  /** Lo que se ahorra en total (para elegir la mejor) */
  saving: number;
};

/** ¿Es para este cliente? (sin contar compra mínima ni productos) */
export function promoForCustomer(p: Promotion, who: { isNew: boolean; isClub: boolean }) {
  return p.audience === "all" || (p.audience === "new" && who.isNew) || (p.audience === "club" && who.isClub);
}

/** Lo que da una promoción en este pedido (null si no aplica) */
export function evaluatePromotion(p: Promotion, ctx: PromoContext): PromoResult | null {
  if (promoState(p, ctx.now || new Date()) !== "activa") return null;
  if (!promoForCustomer(p, ctx)) return null;
  const subtotal = Math.max(0, Number(ctx.subtotal) || 0);
  if (p.minPurchase > 0 && subtotal < p.minPurchase) return null;
  if (p.kind === "freeShipping") {
    if (!ctx.delivery) return null;
    // Envío por cotizar: no se sabe cuánto es, pero sí le conviene
    return { promo: p, discount: 0, freeShipping: true, saving: Math.max(0.01, Number(ctx.deliveryFee) || 0) };
  }
  let discount = 0;
  if (p.kind === "percent") {
    discount = (subtotal * p.value) / 100;
    if (p.maxDiscount > 0) discount = Math.min(discount, p.maxDiscount);
  } else if (p.kind === "amount") discount = p.value;
  else discount = twoForOne(p, ctx.lines);
  discount = round(Math.max(0, Math.min(discount, subtotal)));
  if (!(discount > 0)) return null;
  return { promo: p, discount, freeShipping: false, saving: discount };
}

/** La promoción que más le ahorra a este cliente en este pedido */
export function bestPromotion(promos: Promotion[], ctx: PromoContext): PromoResult | null {
  let best: PromoResult | null = null;
  for (const p of promos) {
    const r = evaluatePromotion(p, ctx);
    if (r && (!best || r.saving > best.saving)) best = r;
  }
  return best;
}

/** Promociones que se anuncian en el menú (activas hoy; su texto dice para quién son) */
export function visiblePromotions(promos: Promotion[], now = new Date()) {
  return promos.filter((p) => promoState(p, now) === "activa");
}

/** Descuento total de un pedido en línea (cupón + promoción) */
export function onlineDiscount(d: { coupon?: { discount: number }; promo?: { discount: number } }) {
  return round((Number(d.coupon?.discount) || 0) + (Number(d.promo?.discount) || 0));
}
