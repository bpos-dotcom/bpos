/**
 * Granel en el menú digital: el cliente pide ¼ kg, ½ kg, 1.5 kg o 3 m (no
 * solo piezas enteras). Lo usan la página pública, la caja al aceptar el
 * pedido (vuelve a limpiar la cantidad) y los textos (WhatsApp, Pedidos en
 * línea). Sin nada del navegador ni del servidor.
 */

export type BulkUnit = "kg" | "g" | "L" | "m";
const BULK_UNITS: BulkUnit[] = ["kg", "g", "L", "m"];

/** Unidad a granel del artículo, o null si se vende por pieza */
export function bulkUnitOf(p: { sellBy?: unknown; unit?: unknown }): BulkUnit | null {
  return p.sellBy === "granel" && BULK_UNITS.includes(p.unit as BulkUnit) ? (p.unit as BulkUnit) : null;
}

/** Cantidades para elegir rápido */
export function bulkChoices(unit: BulkUnit): number[] {
  if (unit === "g") return [100, 250, 500, 1000];
  if (unit === "m") return [0.5, 1, 1.5, 2, 3, 5, 10];
  return [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5];
}

/** Cuánto suma o resta el + y − del carrito */
export function bulkStep(unit: BulkUnit) {
  return unit === "g" ? 50 : unit === "m" ? 0.5 : 0.25;
}

const MAX: Record<BulkUnit, number> = { kg: 100, L: 100, m: 500, g: 50000 };
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Cantidad que se respeta: a granel con hasta 3 decimales (entre el paso
 * mínimo y un máximo razonable); por pieza, entera de 1 a 50.
 */
export function cleanOnlineQty(quantity: unknown, unit: BulkUnit | null) {
  const q = Number(quantity);
  if (!unit) return Math.max(1, Math.min(50, Math.round(Number.isFinite(q) ? q : 1) || 1));
  const min = unit === "g" ? 1 : 0.05;
  return round3(Math.max(min, Math.min(MAX[unit], Number.isFinite(q) && q > 0 ? q : bulkStep(unit))));
}

const num = (n: number) => round3(n).toLocaleString("es-MX", { maximumFractionDigits: 3 });

/** "250 g", "1.5 kg", "500 ml", "3 m"; por pieza solo el número ("2") */
export function qtyText(quantity: number, unit?: string | null) {
  const q = Number(quantity) || 0;
  if (unit === "kg") return q < 1 ? `${Math.round(q * 1000)} g` : `${num(q)} kg`;
  if (unit === "L") return q < 1 ? `${Math.round(q * 1000)} ml` : `${num(q)} L`;
  if (unit === "m") return `${num(q)} m`;
  if (unit === "g") return q >= 1000 ? `${num(q / 1000)} kg` : `${num(q)} g`;
  return num(q);
}

/** Cuántas cosas hay en el carrito (un renglón a granel cuenta como 1) */
export const cartCount = (lines: { quantity: number; unit?: string | null }[]) => lines.reduce((s, l) => s + (l.unit ? 1 : l.quantity), 0);

/** "2 × Burger" o "250 g de Jitomate" */
export function lineLabel(l: { quantity: number; name: string; unit?: string | null }, times = "×") {
  return l.unit ? `${qtyText(l.quantity, l.unit)} de ${l.name}` : `${qtyText(l.quantity)} ${times} ${l.name}`;
}

/** + y − del carrito: a granel de a un paso (¼ kg, ½ m); por pieza de a uno. 0 = se quita el renglón */
export function stepQty(line: { quantity: number; unit?: string | null }, delta: number) {
  const unit = BULK_UNITS.includes(line.unit as BulkUnit) ? (line.unit as BulkUnit) : null;
  if (!unit) return Math.max(0, line.quantity + delta);
  const next = round3(line.quantity + delta * bulkStep(unit));
  return next < bulkStep(unit) - 1e-9 ? 0 : Math.min(MAX[unit], next);
}
