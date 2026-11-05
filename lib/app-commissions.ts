"use client";
/**
 * Comisiones de las apps de delivery (Finanzas → ⚙️ Comisiones de apps):
 * cuánto le quitan DiDi, Uber o Rappi a lo vendido, para estimar cuánto te
 * van a depositar. Ej. DiDi 30% de comisión y luego 17% de impuestos sobre lo
 * que queda: $1,000 vendidos → $700 → $581 de depósito aproximado.
 *
 * Mientras no registres el depósito real de una semana, Finanzas usa este
 * estimado (y lo marca como estimado); al registrarlo, el real lo reemplaza.
 */
export type AppCommission = {
  /** % de comisión sobre lo vendido */
  commission: number;
  /** % de impuestos o retenciones */
  taxes: number;
  /** true: los impuestos son sobre lo vendido; si no, sobre lo que queda después de la comisión */
  taxOnSale?: boolean;
};

const KEY = "bpos_app_commissions";
export const COMMISSIONS_EVENT = "bpos:commissions-updated";
export const DELIVERY_APPS = ["DiDi", "Uber", "Rappi"];

export function getAppCommissions(): Record<string, AppCommission> {
  if (typeof window === "undefined") return {};
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}") as { apps?: Record<string, AppCommission> };
    return raw.apps && typeof raw.apps === "object" ? raw.apps : {};
  } catch {
    return {};
  }
}

export function saveAppCommissions(apps: Record<string, AppCommission>) {
  localStorage.setItem(KEY, JSON.stringify({ apps }));
  window.dispatchEvent(new Event(COMMISSIONS_EVENT));
}

/** Nombre corto de la app de un pedido de delivery ("Uber Eats" → "Uber", "DiDi Food" → "DiDi") */
export function deliveryApp(o: { externalPlatform?: string; details?: { orderType?: string } }) {
  const raw = `${o.externalPlatform || o.details?.orderType || ""}`;
  const low = raw.toLowerCase();
  return low.includes("uber") ? "Uber" : low.includes("didi") ? "DiDi" : low.includes("rappi") ? "Rappi" : raw || "Otra app";
}

/** Qué parte de lo vendido te llega (0.581 = 58.1%) */
export function netFactor(c: AppCommission) {
  const commission = Math.min(100, Math.max(0, Number(c.commission) || 0)) / 100;
  const taxes = Math.min(100, Math.max(0, Number(c.taxes) || 0)) / 100;
  return Math.max(0, c.taxOnSale ? 1 - commission - taxes : (1 - commission) * (1 - taxes));
}

/** Configurada si tiene comisión o impuestos */
export const isConfigured = (c: AppCommission | undefined): c is AppCommission => Boolean(c && ((Number(c.commission) || 0) > 0 || (Number(c.taxes) || 0) > 0));

/** Depósito aproximado de lo vendido en una app (null si esa app no tiene comisiones configuradas) */
export function estimatedDeposit(app: string, sales: number, apps = getAppCommissions()) {
  const c = apps[app];
  return isConfigured(c) ? sales * netFactor(c) : null;
}
