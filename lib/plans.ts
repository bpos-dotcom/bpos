/**
 * Bloque 15 · Planes de B-POS (precio por sucursal al mes, en pesos).
 * La nube guarda el plan de cada negocio (0006_bpos_planes.sql); aquí solo
 * están los nombres, precios y qué incluye cada uno para las pantallas.
 */
export type PlanId = "basic" | "pro" | "max";

export const PLANS: Record<PlanId, { name: string; price: number; features: string[]; ai: boolean }> = {
  basic: {
    name: "Basic",
    price: 399,
    ai: false,
    features: ["POS, caja y cortes", "Impresoras por estación", "Menú digital con QR y pedidos sin comisión", "Inventario, recetas y reportes", "Club de clientes y app del dueño"],
  },
  pro: {
    name: "Pro",
    price: 599,
    ai: false,
    features: ["Todo lo de Basic", "Cocina en pantalla (KDS)", "B-POS Bridge: Rappi, Uber Eats y DiDi Food", "Combos, opciones y multidestino"],
  },
  max: {
    name: "Max",
    price: 899,
    ai: true,
    features: ["Todo lo de Pro", "🤖 Subir menú con IA", "🤖 Compras con foto del ticket", "🤖 Asesor semanal"],
  },
};

/** Cobro mensual o anual. El anual cuesta 10 meses: 2 meses gratis. */
export type BillingPeriod = "monthly" | "annual";
export const ANNUAL_MONTHS_CHARGED = 10;

export function isBillingPeriod(value: unknown): value is BillingPeriod {
  return value === "monthly" || value === "annual";
}

/** Precio por sucursal del plan en el periodo (mensual = PLANS[plan].price; anual = 10 × mensual). */
export function planPrice(plan: PlanId | string, period: BillingPeriod = "monthly") {
  const monthly = PLANS[(plan as PlanId) in PLANS ? (plan as PlanId) : "basic"].price;
  return period === "annual" ? monthly * ANNUAL_MONTHS_CHARGED : monthly;
}

export function periodLabel(period: string | null | undefined) {
  return period === "annual" ? "Anual" : "Mensual";
}

/** external_reference de Mercado Pago: "negocio|plan|sucursales" (mensual) o "negocio|plan|sucursales|annual". */
export function referenceFor(businessId: string, plan: PlanId, branches: number, period: BillingPeriod = "monthly") {
  return period === "annual" ? `${businessId}|${plan}|${branches}|annual` : `${businessId}|${plan}|${branches}`;
}

/** Las referencias viejas de 3 partes son mensuales. */
export function parseReference(ref?: string) {
  const [businessId, plan, branches, period] = String(ref || "").split("|");
  return {
    businessId,
    plan: (plan in PLANS ? plan : "basic") as PlanId,
    branches: Math.max(1, Number(branches) || 1),
    period: (period === "annual" ? "annual" : "monthly") as BillingPeriod,
  };
}

/** Qué incluye cada plan además de lo básico (la prueba gratis incluye todo) */
export type PlanFeature = "kds" | "delivery" | "ai";
const FEATURES: Record<PlanId, PlanFeature[]> = { basic: [], pro: ["kds", "delivery"], max: ["kds", "delivery", "ai"] };

export function planIncludes(state: Pick<PlanState, "plan" | "plan_status"> | null | undefined, feature: PlanFeature) {
  if (!state) return true; // sin dato (sin internet, nube sin configurar): no se bloquea
  if (state.plan_status === "trial") return true;
  return (FEATURES[(state.plan as PlanId) || "basic"] || []).includes(feature);
}

export const TRIAL_DAYS = 14;

export function planLabel(plan: string | null | undefined) {
  return PLANS[(plan as PlanId) || "basic"]?.name || "Basic";
}

export type PlanState = { plan: string; plan_status: string; trial_ends_at: string | null; paid_until: string | null };

/**
 * ¿El negocio puede seguir usando B-POS? Bloqueo amable: solo cuando la prueba
 * terminó o lo pagado ya venció (Mercado Pago da 3 días de gracia en paid_until).
 * Un plan activo sin fecha es una activación manual y no vence.
 */
export function planAccess(state: PlanState, now = Date.now()) {
  const until = (date: string | null) => (date ? new Date(date).getTime() : null);
  const trialEnd = until(state.trial_ends_at);
  const paidEnd = until(state.paid_until);
  const daysLeft = (end: number | null) => (end === null ? null : Math.ceil((end - now) / 86_400_000));

  if (state.plan_status === "trial") {
    const days = daysLeft(trialEnd);
    return { locked: days !== null && days <= 0, warning: days !== null && days > 0 && days <= 3 ? `Te quedan ${days} día(s) de prueba gratis.` : "" };
  }
  if (state.plan_status === "active") {
    return { locked: paidEnd !== null && paidEnd < now, warning: "" };
  }
  // past_due o cancelled: sigue hasta lo ya pagado
  const days = daysLeft(paidEnd);
  if (days === null || days <= 0) return { locked: true, warning: "" };
  return { locked: false, warning: state.plan_status === "past_due" ? `Hay un pago pendiente. Tu plan se pausa en ${days} día(s).` : `Cancelaste tu plan. Sigue activo ${days} día(s).` };
}
