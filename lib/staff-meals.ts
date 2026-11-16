"use client";
/**
 * Cena del personal: cada empleado marca su comida del día desde la sección
 * Personal (como el POS, pero sin cobro).
 *
 * - Se configura en Configuración → Cena del personal (bpos_staff_meal_config,
 *   por sucursal): quiénes tienen cena, qué días les toca, qué pueden elegir y
 *   el tope por cena.
 * - La cena se guarda como un pedido más (bpos_orders) con `staffMeal`: así
 *   llega a cocina y a las estaciones, descuenta inventario y se sincroniza
 *   como cualquier pedido. Total $0 y NO es venta: reportes, corte de caja,
 *   dashboard y clientes la dejan fuera (isStaffMeal).
 * - Un crédito por persona por día. El día empieza a la hora configurada
 *   (ej. 5 a.m.), para que la cena de las 12:30 a.m. cuente en el turno de ayer.
 */
import { addAuditEvent } from "@/lib/audit";
import { cancelSale, isCancelled } from "@/lib/sale-cancel";
import { getUsers } from "@/lib/users";
import { lastPunch } from "@/lib/timeclock";
import type { ModifierGroup } from "@/data/products";

export const STAFF_MEAL_CONFIG_KEY = "bpos_staff_meal_config";
export const STAFF_MEAL_EVENT = "bpos:staff-meal-updated";
export const STAFF_MEAL_TYPE = "Cena del personal";

export type StaffPerson = {
  id: string;
  name: string;
  /** Usuario de B-POS (si lo es): sirve para revisar el checador */
  userId?: number;
  /** Días que le toca (0 = domingo … 6 = sábado) */
  days: number[];
  active: boolean;
};

export type StaffMealConfig = {
  enabled: boolean;
  people: StaffPerson[];
  /** Categorías que pueden elegir ([] = todas) */
  categories: string[];
  /** Productos que no pueden elegir aunque su categoría sí */
  blockedProducts: number[];
  /** Máximo de piezas por cena (0 = sin tope) */
  maxItems: number;
  /** Máximo en precio de menú por cena (0 = sin tope) */
  maxValue: number;
  /** Hora en que empieza el día de la cena (0-12) */
  dayStartHour: number;
  /** Solo puede marcar si checó entrada (usuarios de B-POS) */
  requireClockIn: boolean;
};

export const DEFAULT_STAFF_MEAL_CONFIG: StaffMealConfig = {
  enabled: false,
  people: [],
  categories: [],
  blockedProducts: [],
  maxItems: 0,
  maxValue: 0,
  dayStartHour: 5,
  requireClockIn: false,
};

export const WEEK_DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export function normalizeConfig(raw: Partial<StaffMealConfig> | null | undefined): StaffMealConfig {
  const c = { ...DEFAULT_STAFF_MEAL_CONFIG, ...(raw || {}) };
  const hour = Math.floor(Number(c.dayStartHour));
  return {
    enabled: Boolean(c.enabled),
    people: (Array.isArray(c.people) ? c.people : [])
      .filter((p) => p && String(p.name || "").trim())
      .map((p) => ({
        id: String(p.id || `p-${Math.random().toString(36).slice(2, 9)}`),
        name: String(p.name).trim(),
        ...(Number(p.userId) > 0 ? { userId: Number(p.userId) } : {}),
        days: Array.isArray(p.days) ? ALL_DAYS.filter((d) => p.days.includes(d)) : [...ALL_DAYS],
        active: p.active !== false,
      })),
    categories: Array.isArray(c.categories) ? c.categories.map(String) : [],
    blockedProducts: Array.isArray(c.blockedProducts) ? c.blockedProducts.map(Number).filter((n) => Number.isFinite(n)) : [],
    maxItems: Math.max(0, Math.floor(Number(c.maxItems) || 0)),
    maxValue: Math.max(0, Number(c.maxValue) || 0),
    dayStartHour: Number.isFinite(hour) ? Math.min(12, Math.max(0, hour)) : 5,
    requireClockIn: Boolean(c.requireClockIn),
  };
}

export function getStaffMealConfig(): StaffMealConfig {
  if (typeof window === "undefined") return DEFAULT_STAFF_MEAL_CONFIG;
  try {
    return normalizeConfig(JSON.parse(localStorage.getItem(STAFF_MEAL_CONFIG_KEY) || "null"));
  } catch {
    return DEFAULT_STAFF_MEAL_CONFIG;
  }
}

export function saveStaffMealConfig(next: StaffMealConfig, by = "") {
  const clean = normalizeConfig(next);
  localStorage.setItem(STAFF_MEAL_CONFIG_KEY, JSON.stringify(clean));
  window.dispatchEvent(new Event(STAFF_MEAL_EVENT));
  addAuditEvent({ category: "Configuración", action: "staff_meal.config", description: `${by || "B-POS"} cambió la configuración de la cena del personal`, userName: by || undefined });
  return clean;
}

/** Usuarios activos de B-POS que todavía no están en la lista (para agregarlos con un toque) */
export function usersNotInList(config: StaffMealConfig) {
  const inList = new Set(config.people.map((p) => p.userId).filter(Boolean));
  return getUsers().filter((u) => u.active && u.id > 0 && !inList.has(u.id));
}

// ------------------------------------------------------------ el día de la cena

/** Fecha del "día de la cena" (AAAA-MM-DD, hora local): antes de la hora de inicio cuenta como ayer */
export function mealDay(at: Date | string | number, dayStartHour: number) {
  const d = new Date(new Date(at).getTime() - dayStartHour * 3600_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Día de la semana del día de la cena (0 = domingo) */
export function mealWeekday(at: Date | string | number, dayStartHour: number) {
  return new Date(new Date(at).getTime() - dayStartHour * 3600_000).getDay();
}

// ------------------------------------------------------------ pedidos de cena

export type StaffMealInfo = { personId: string; name: string; by?: string; cost?: number };

type OrderLike = { id: number; createdAt: string; cancelled?: boolean; staffMeal?: StaffMealInfo };

export function isStaffMeal(order: unknown): boolean {
  return Boolean(order && typeof order === "object" && (order as { staffMeal?: unknown }).staffMeal);
}

/** Cena que ya marcó hoy esa persona (no cuenta si se deshizo) */
export function mealToday<T extends OrderLike>(orders: T[], personId: string, config: Pick<StaffMealConfig, "dayStartHour">, now = new Date()): T | undefined {
  const today = mealDay(now, config.dayStartHour);
  return orders.find((o) => o.staffMeal?.personId === personId && !isCancelled(o) && mealDay(o.createdAt, config.dayStartHour) === today);
}

export type PersonStatus =
  | { kind: "ok" }
  | { kind: "used"; at: string; order: OrderLike }
  | { kind: "off"; reason: string };

/** ¿Puede marcar su cena ahorita? */
export function personStatus(
  person: StaffPerson,
  orders: OrderLike[],
  config: StaffMealConfig,
  now = new Date(),
  clockedIn: (userId: number) => boolean = (id) => lastPunch(id)?.type === "entrada"
): PersonStatus {
  const used = mealToday(orders, person.id, config, now);
  if (used) return { kind: "used", at: used.createdAt, order: used };
  if (!person.active) return { kind: "off", reason: "Sin cena" };
  if (!person.days.includes(mealWeekday(now, config.dayStartHour))) return { kind: "off", reason: "No está en turno hoy" };
  if (config.requireClockIn && person.userId && !clockedIn(person.userId)) return { kind: "off", reason: "No ha checado entrada" };
  return { kind: "ok" };
}

// ------------------------------------------------------------ qué puede elegir

type ProductLike = { id: number | string; category: string; price: number };

export function productAllowed(product: ProductLike, config: Pick<StaffMealConfig, "categories" | "blockedProducts">) {
  if (config.blockedProducts.includes(Number(product.id))) return false;
  return !config.categories.length || config.categories.includes(product.category);
}

/** Revisa el tope: "" si está bien, o por qué no */
export function capProblem(items: { price: number; quantity: number }[], config: Pick<StaffMealConfig, "maxItems" | "maxValue">) {
  const pieces = items.reduce((n, i) => n + (Number(i.quantity) || 0), 0);
  const value = Math.round(items.reduce((n, i) => n + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0) * 100) / 100;
  if (config.maxItems > 0 && pieces > config.maxItems) return `El tope es de ${config.maxItems} ${config.maxItems === 1 ? "producto" : "productos"} por cena (lleva ${pieces}).`;
  // Sin montos: en Personal no se muestran precios
  if (config.maxValue > 0 && value > config.maxValue) return "Se pasa del tope de la cena. Quita algo.";
  return "";
}

/**
 * Sin extras con costo: quita las opciones que cobran (+$25 Carne extra) y, en
 * grupos que cobran las de más, no deja pasar de las incluidas. Los grupos que
 * se quedan sin nada que elegir gratis desaparecen.
 */
export function withoutPaidExtras<P extends { modifierGroups?: ModifierGroup[] }>(product: P): P {
  if (!product.modifierGroups?.length) return product;
  const groups = product.modifierGroups.flatMap((g): ModifierGroup[] => {
    const options = g.options.filter((o) => !(Number(o.extraPrice) > 0));
    if (!options.length) return [];
    let max = g.max;
    if (Number(g.extraPrice) > 0) {
      const free = Number(g.included) || 0;
      if (free <= 0) return [];
      max = g.max > 0 ? Math.min(g.max, free) : free;
    }
    const min = max > 0 ? Math.min(g.min, max) : g.min;
    // Obligatorio con una sola opción ("No, gracias"): ya va elegida
    if (min > 0 && options.length === 1) max = min;
    return [{ ...g, options, min, max, extraPrice: 0 }];
  });
  return { ...product, modifierGroups: groups };
}

/** "2x Hamburguesa, 1x Papas" */
export function itemsText(items: { name: string; quantity: number }[]) {
  return items.map((i) => `${i.quantity}x ${i.name}`).join(", ");
}

/** El pedido de la cena: total $0, ya "pagado" (no queda en cuentas en espera) */
export function buildStaffMealOrder<I extends { name: string; quantity: number; price: number }>(input: {
  id: number;
  person: StaffPerson;
  items: I[];
  by: string;
  now?: Date;
  sequence?: { localOrderNumber: number; shiftSessionId: string } | null;
}) {
  const now = (input.now || new Date()).toISOString();
  return {
    id: input.id,
    ...(input.sequence ? { localOrderNumber: input.sequence.localOrderNumber, shiftSessionId: input.sequence.shiftSessionId } : {}),
    createdAt: now,
    items: input.items,
    details: { orderType: STAFF_MEAL_TYPE, customerName: input.person.name, customerPhone: "", customerAddress: "", paymentMethod: STAFF_MEAL_TYPE, discount: 0 },
    subtotal: 0,
    total: 0,
    paidAt: now,
    soldBy: input.by,
    staffMeal: { personId: input.person.id, name: input.person.name, ...(input.by ? { by: input.by } : {}) } as StaffMealInfo,
  };
}

/** Deshacer una cena (se marcó por error): queda cancelada y la persona puede volver a marcar */
export function undoStaffMeal<T extends OrderLike>(order: T, reason: string, by: string): T {
  return cancelSale(order, reason, by);
}
