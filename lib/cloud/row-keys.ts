/**
 * Listas que se sincronizan renglón por renglón aunque sus elementos no
 * tengan un id único.
 *
 * El kardex guarda varios renglones con el mismo id (uno por insumo de la
 * venta) y las ventas ya descontadas son solo textos. Antes viajaban a la
 * nube como UN documento completo: cada venta lo cambiaba y todos los
 * equipos volvían a bajar el kardex entero (1-2 MB), y eso disparaba el
 * tráfico de Supabase. Ahora cada renglón lleva un id calculado y viaja
 * solo.
 *
 * Van en otra colección de la nube ("rows:<llave>"): los equipos con la
 * versión anterior no la leen (no empieza con "bpos_") y siguen con su
 * documento hasta que se actualizan, sin pelearse con los nuevos.
 */
import { archiveIds } from "@/lib/kardex-archive";

const KARDEX_KEY = "bpos_inventory_kardex";
const APPLIED_KEY = "bpos_inventory_applied_sales";

/** Mismo texto → mismo id; si se repite, se le agrega un contador */
export function countedIds(bases: string[]) {
  const seen = new Map<string, number>();
  return bases.map((base) => {
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}~${n}`;
  });
}

export const ROW_KEYS: Record<string, (list: unknown[]) => string[]> = {
  [KARDEX_KEY]: archiveIds,
  [APPLIED_KEY]: (list) => countedIds(list.map((v) => (typeof v === "string" ? v : JSON.stringify(v)))),
};

export const ROWS_PREFIX = "rows:";

export function isRowKey(key: string) {
  return Object.prototype.hasOwnProperty.call(ROW_KEYS, key);
}

/** Colección de la nube donde vive una llave del navegador */
export function cloudCollection(key: string) {
  return isRowKey(key) ? `${ROWS_PREFIX}${key}` : key;
}

/**
 * Llave del navegador de una colección de la nube. null = no se aplica
 * (el documento completo que siguen subiendo los equipos sin actualizar).
 */
export function localKeyOf(collection: string): string | null {
  if (collection.startsWith(ROWS_PREFIX)) {
    const key = collection.slice(ROWS_PREFIX.length);
    return isRowKey(key) ? key : null;
  }
  if (isRowKey(collection)) return null;
  return collection;
}

/** Colecciones viejas que los equipos actualizados ya no bajan */
export const LEGACY_DOC_COLLECTIONS = Object.keys(ROW_KEYS);

/** La lista guardada en el navegador (sea como venga) */
export function rowListOf(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function timeOf(item: unknown) {
  const at = item && typeof item === "object" ? (item as { createdAt?: unknown }).createdAt : undefined;
  const t = typeof at === "string" ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? t : NaN;
}

export type RowChange = { record_id: string; data: unknown; deleted: boolean; hash?: string };

/**
 * Aplica cambios de la nube a una de estas listas. Lo nuevo va en su lugar
 * por fecha (el kardex va del más viejo al más nuevo); si no tiene fecha,
 * al final. Regresa la lista nueva y cambia `shadow` (id → huella).
 */
export function applyRowChanges(key: string, list: unknown[], changes: RowChange[], shadow: Record<string, string>) {
  const idsOf = ROW_KEYS[key];
  const next = [...list];
  let ids = idsOf(next);
  for (const change of changes) {
    if (!change.deleted && change.hash && shadow[change.record_id] === change.hash) continue; // ya lo tengo
    const index = ids.indexOf(change.record_id);
    if (change.deleted) {
      if (index >= 0) {
        next.splice(index, 1);
        ids.splice(index, 1);
      }
      delete shadow[change.record_id];
      continue;
    }
    if (index >= 0) {
      next[index] = change.data;
    } else {
      const t = timeOf(change.data);
      const lastT = timeOf(next[next.length - 1]);
      if (!next.length || !Number.isFinite(t) || !Number.isFinite(lastT) || t >= lastT) {
        next.push(change.data);
        ids.push(change.record_id);
      } else {
        const at = next.findIndex((item) => timeOf(item) > t);
        next.splice(at < 0 ? next.length : at, 0, change.data);
        ids = idsOf(next);
      }
    }
    if (change.hash) shadow[change.record_id] = change.hash;
  }
  return next;
}

/**
 * La revisión hacia atrás (por si un cambio llegó fuera de orden) primero
 * pide solo los números de cambio; el contenido se baja solo de los que
 * este equipo no ha visto.
 */
export function unseenSeqs(seqs: number[], seen: Set<number>) {
  return seqs.filter((s) => !seen.has(s));
}

/** Recuerda los últimos números de cambio vistos (sin crecer sin fin) */
export function rememberSeqs(seen: Set<number>, seqs: number[], max = 3000) {
  seqs.forEach((s) => seen.add(s));
  if (seen.size <= max) return;
  const sorted = [...seen].sort((a, b) => a - b);
  sorted.slice(0, sorted.length - max).forEach((s) => seen.delete(s));
}
