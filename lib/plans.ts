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
    features: ["POS, caja y cortes", "Cocina (KDS) e impresoras por estación", "Inventario y recetas", "Reportes", "App del dueño"],
  },
  pro: {
    name: "Pro",
    price: 599,
    ai: false,
    features: ["Todo lo de Basic", "B-POS Bridge: Rappi, Uber Eats y DiDi Food", "Combos, opciones y multidestino", "Avisos al celular"],
  },
  max: {
    name: "Max",
    price: 899,
    ai: true,
    features: ["Todo lo de Pro", "🤖 Subir menú con IA", "🤖 Equivalencias de delivery con IA"],
  },
};

export const TRIAL_DAYS = 14;

export function planLabel(plan: string | null | undefined) {
  return PLANS[(plan as PlanId) || "basic"]?.name || "Basic";
}
