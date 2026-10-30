"use client";
/**
 * Cupones (Entrega 4): códigos de descuento que sirven en el POS y en el
 * menú digital. Se guardan en "bpos_coupons" (compartido por todas las
 * sucursales). Cada venta con cupón suma un uso; el menú digital revisa el
 * cupón en la nube (bpos_menu_coupon) con las mismas reglas.
 */

export type Coupon = {
  id: string;
  /** Lo que escribe el cliente (BURGER10) */
  code: string;
  kind: "percent" | "amount";
  /** % o pesos */
  value: number;
  /** Compra mínima (0 = cualquiera) */
  minPurchase: number;
  /** Tope de descuento para cupones de % (0 = sin tope) */
  maxDiscount: number;
  /** Vigencia "AAAA-MM-DD" ("" = sin fecha) */
  from: string;
  until: string;
  /** Usos permitidos en total (0 = sin límite) y usados */
  maxUses: number;
  uses: number;
  /** Dónde sirve */
  pos: boolean;
  online: boolean;
  active: boolean;
  note: string;
  createdAt: string;
};

export type CouponChannel = "pos" | "online";

const KEY = "bpos_coupons";
export const COUPONS_EVENT = "bpos:coupons-updated";

/** "burger 10" → "BURGER10" */
export const normalizeCode = (code: string) =>
  String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9Ñ-]/g, "")
    .slice(0, 20);

export function getCoupons(): Coupon[] {
  if (typeof window === "undefined") return [];
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? (list as Coupon[]) : [];
  } catch {
    return [];
  }
}

function write(list: Coupon[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(COUPONS_EVENT));
}

export function saveCoupon(coupon: Coupon) {
  const code = normalizeCode(coupon.code);
  if (code.length < 3) throw new Error("El código lleva al menos 3 letras o números.");
  if (!(coupon.value > 0)) throw new Error("Escribe el descuento.");
  if (coupon.kind === "percent" && coupon.value > 100) throw new Error("El descuento no puede ser más de 100%.");
  const list = getCoupons();
  if (list.some((c) => c.id !== coupon.id && normalizeCode(c.code) === code)) throw new Error("Ya tienes un cupón con ese código.");
  const next = { ...coupon, code };
  write(list.some((c) => c.id === coupon.id) ? list.map((c) => (c.id === coupon.id ? next : c)) : [...list, next]);
}

export function deleteCoupon(id: string) {
  write(getCoupons().filter((c) => c.id !== id));
}

export function newCoupon(): Coupon {
  return {
    id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    code: "",
    kind: "percent",
    value: 10,
    minPurchase: 0,
    maxDiscount: 0,
    from: "",
    until: "",
    maxUses: 0,
    uses: 0,
    pos: true,
    online: true,
    active: true,
    note: "",
    createdAt: new Date().toISOString(),
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Descuento en pesos de un cupón para esa compra */
export function couponDiscount(coupon: Pick<Coupon, "kind" | "value" | "maxDiscount">, subtotal: number) {
  const raw = coupon.kind === "percent" ? (subtotal * coupon.value) / 100 : coupon.value;
  const capped = coupon.kind === "percent" && coupon.maxDiscount > 0 ? Math.min(raw, coupon.maxDiscount) : raw;
  return round(Math.max(0, Math.min(capped, subtotal)));
}

/** "10% de descuento" · "$50 de descuento" */
export function couponLabel(coupon: Pick<Coupon, "kind" | "value" | "maxDiscount" | "minPurchase">) {
  const what = coupon.kind === "percent" ? `${coupon.value}% de descuento` : `$${coupon.value} de descuento`;
  const cap = coupon.kind === "percent" && coupon.maxDiscount > 0 ? ` (hasta $${coupon.maxDiscount})` : "";
  const min = coupon.minPurchase > 0 ? ` en compras desde $${coupon.minPurchase}` : "";
  return `${what}${cap}${min}`;
}

const today = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

/** Estado del cupón hoy (para la lista) */
export function couponState(c: Coupon, now = new Date()): "activo" | "pausado" | "por empezar" | "vencido" | "agotado" {
  const day = today(now);
  if (!c.active) return "pausado";
  if (c.until && day > c.until) return "vencido";
  if (c.from && day < c.from) return "por empezar";
  if (c.maxUses > 0 && c.uses >= c.maxUses) return "agotado";
  return "activo";
}

export type CouponCheck = { ok: true; coupon: Coupon; discount: number } | { ok: false; error: string };

/** Revisa un código para una compra: existe, está vigente, sirve aquí y alcanza la compra mínima. */
export function checkCoupon(code: string, subtotal: number, channel: CouponChannel, now = new Date()): CouponCheck {
  const wanted = normalizeCode(code);
  if (!wanted) return { ok: false, error: "Escribe el código del cupón." };
  const coupon = getCoupons().find((c) => normalizeCode(c.code) === wanted);
  if (!coupon) return { ok: false, error: "Ese cupón no existe." };
  const state = couponState(coupon, now);
  if (state !== "activo") return { ok: false, error: `El cupón ${wanted} está ${state}.` };
  if (!coupon[channel]) return { ok: false, error: channel === "pos" ? "Ese cupón solo es para el menú digital." : "Ese cupón solo es para el mostrador." };
  if (coupon.minPurchase > 0 && subtotal < coupon.minPurchase) return { ok: false, error: `El cupón ${wanted} es para compras desde $${coupon.minPurchase}.` };
  return { ok: true, coupon, discount: couponDiscount(coupon, subtotal) };
}

/** Suma un uso al cupón (al cobrar la venta) */
export function countCouponUse(code: string) {
  const wanted = normalizeCode(code);
  const list = getCoupons();
  if (!list.some((c) => normalizeCode(c.code) === wanted)) return;
  write(list.map((c) => (normalizeCode(c.code) === wanted ? { ...c, uses: (Number(c.uses) || 0) + 1 } : c)));
}
