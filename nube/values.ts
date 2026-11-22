/**
 * Cómo se guarda cada tipo de columna en D1 y cómo se devuelve (igual que
 * Supabase): uuid, texto y fechas como texto; jsonb como texto JSON; bool
 * como 0/1; números como número.
 */
import type { Column, ColType } from "./tables";

export const nowIso = () => new Date().toISOString();

/** Fecha y hora → "2026-11-21T16:00:00.000Z" (así se ordenan bien como texto) */
export function normalizeTs(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  const s = String(value).trim();
  // Postgres acepta "2026-11-21 16:00:00+00" o con microsegundos
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2} \d/.test(s) ? s.replace(" ", "T") : s);
  if (!Number.isFinite(ms)) return s;
  return new Date(ms).toISOString();
}

export function normalizeDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : s;
}

/** Valor que manda B-POS → valor para D1 */
export function toDb(type: ColType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (type) {
    case "bool":
      if (typeof value === "string") return value === "true" || value === "t" || value === "1" ? 1 : 0;
      return value ? 1 : 0;
    case "int": {
      const n = Number(value);
      return Number.isFinite(n) ? Math.trunc(n) : value;
    }
    case "num": {
      const n = Number(value);
      return Number.isFinite(n) ? n : value;
    }
    case "json":
      return JSON.stringify(value);
    case "ts":
      return normalizeTs(value);
    case "date":
      return normalizeDate(value);
    default:
      return typeof value === "string" ? value : String(value);
  }
}

/** Valor de un filtro (siempre llega como texto en la dirección) → valor para comparar en D1 */
export function filterValue(type: ColType, raw: string): unknown {
  if (type === "json") return raw;
  if (type === "bool") return raw === "true" || raw === "t" ? 1 : raw === "false" || raw === "f" ? 0 : raw;
  return toDb(type, raw);
}

/** Valor de D1 → lo que devuelve Supabase */
export function fromDb(type: ColType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (type) {
    case "bool":
      return value === 1 || value === true || value === "1";
    case "int":
    case "num":
      return typeof value === "number" ? value : Number(value);
    case "json":
      if (typeof value !== "string") return value;
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    default:
      return value;
  }
}

export function rowFromDb(columns: Column[], row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const col of columns) if (col.name in row) out[col.name] = fromDb(col.type, row[col.name]);
  return out;
}
