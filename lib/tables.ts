"use client";
/**
 * Mesas del restaurante (Configuración → Mesas): nombre, zona (Salón,
 * Terraza...) y lugares. Compartidas por todas las sucursales del negocio
 * (bpos_tables se sincroniza como llave del negocio).
 *
 * En el POS, elegir una mesa deja el pedido como "Mesa · comer aquí"; al
 * mandarlo a cocina queda en Cuentas en espera ligado a esa mesa, se le
 * pueden agregar rondas, sacar la precuenta y cobrarlo (dividido o no).
 */

export type TableShape = "cuadrada" | "redonda" | "larga";
/** x, y: centro de la mesa en el plano de su zona, en % (0-100). Sin x/y se acomoda sola. */
export type Table = { id: string; name: string; zone: string; seats: number; active: boolean; x?: number; y?: number; shape?: TableShape };

export const TABLE_SHAPES: Record<TableShape, string> = { cuadrada: "Cuadrada", redonda: "Redonda", larga: "Larga / barra" };
const pos = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v * 10) / 10)) : undefined);

export const TABLES_KEY = "bpos_tables";
export const TABLES_EVENT = "bpos:tables-updated";
export const DEFAULT_ZONE = "Salón";

/** Mesa guardada en una venta (lo mínimo para mostrarla aunque después la borren) */
export type TableRef = { id: string; name: string; zone: string };

export function getTables(): Table[] {
  try {
    const list = JSON.parse(localStorage.getItem(TABLES_KEY) || "[]");
    return Array.isArray(list)
      ? list
          .filter((t) => t && typeof t.id === "string")
          .map((t) => ({
            id: t.id,
            name: String(t.name || "").trim().slice(0, 30),
            zone: String(t.zone || DEFAULT_ZONE).trim().slice(0, 30) || DEFAULT_ZONE,
            seats: Math.max(0, Math.min(99, Math.round(Number(t.seats) || 0))),
            active: t.active !== false,
            ...(pos(t.x) !== undefined && pos(t.y) !== undefined ? { x: pos(t.x), y: pos(t.y) } : {}),
            ...(t.shape && t.shape in TABLE_SHAPES ? { shape: t.shape as TableShape } : {}),
          }))
      : [];
  } catch {
    return [];
  }
}

export function saveTables(list: Table[]) {
  localStorage.setItem(TABLES_KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(TABLES_EVENT));
}

/** Zonas en el orden en que aparecen sus mesas */
export function tableZones(tables: Table[]) {
  return Array.from(new Set(tables.map((t) => t.zone || DEFAULT_ZONE)));
}

export function tableLabel(table: TableRef | undefined | null, diners?: number) {
  if (!table) return "";
  const who = diners && diners > 0 ? ` · ${diners} ${diners === 1 ? "persona" : "personas"}` : "";
  return `Mesa ${table.name}${who}`;
}

/** Cuenta abierta (en espera, sin cancelar) de una mesa */
export function openTableOrder<T extends { pendingPayment?: boolean; cancelled?: boolean; details: { table?: TableRef } }>(orders: T[], tableId: string): T | undefined {
  return orders.find((o) => o.pendingPayment && !o.cancelled && o.details.table?.id === tableId);
}
