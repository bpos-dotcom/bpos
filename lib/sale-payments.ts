"use client";
/**
 * Con qué se pagó una venta: por método (efectivo, tarjeta, transferencia...)
 * aunque haya sido pago mixto o cuenta dividida, y la propina aparte.
 * Caja y reportes suman por aquí para que el efectivo esperado cuadre.
 */

export type PaidSale = {
  total: number;
  tip?: number;
  tipPayments?: Record<string, number>;
  details: { paymentMethod?: string; payments?: Record<string, number> };
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Venta (sin propina) por método de pago */
export function paymentsOf(sale: PaidSale): Record<string, number> {
  const p = sale.details.payments;
  if (p && Object.keys(p).length) {
    const out: Record<string, number> = {};
    for (const [method, amount] of Object.entries(p)) if (Number(amount) > 0) out[method] = round2(Number(amount));
    return out;
  }
  const method = sale.details.paymentMethod || "Sin método";
  return { [method]: round2(Number(sale.total) || 0) };
}

/** Lo que se pagó con ese método (sin propina) */
export function paidWith(sale: PaidSale, method: string) {
  return paymentsOf(sale)[method] || 0;
}

export function tipOf(sale: PaidSale) {
  return round2(Math.max(0, Number(sale.tip) || 0));
}

/** Propina por método ("Efectivo" entra al cajón) */
export function tipPaidWith(sale: PaidSale, method: string) {
  const tp = sale.tipPayments;
  if (tp && Object.keys(tp).length) return round2(Number(tp[method]) || 0);
  // Sin desglose: la propina va con el método principal
  const main = sale.details.paymentMethod || "";
  return main === method ? tipOf(sale) : 0;
}

/** Reparte un monto entre métodos en el orden dado (lo que no alcanzan los primeros lo cubre el último) */
export function allocate(amount: number, caps: [string, number][]): Record<string, number> {
  let left = round2(amount);
  const out: Record<string, number> = {};
  caps.forEach(([method, cap], i) => {
    const last = i === caps.length - 1;
    const take = last ? left : Math.min(left, Math.max(0, cap));
    if (take > 0) out[method] = round2(take);
    left = round2(left - take);
  });
  return out;
}

/** Nombre del método para mostrar: uno solo, o "Mixto" si fueron varios */
export function methodLabel(payments: Record<string, number>) {
  const used = Object.entries(payments).filter(([, v]) => v > 0).map(([m]) => m);
  return used.length === 1 ? used[0] : used.length > 1 ? "Mixto" : "Sin método";
}

/** Suma de varios desgloses */
export function sumPayments(list: Record<string, number>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of list) for (const [m, v] of Object.entries(p)) if (v > 0) out[m] = round2((out[m] || 0) + v);
  return out;
}
