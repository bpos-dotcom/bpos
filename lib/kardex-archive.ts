/**
 * El kardex crece ~500 movimientos al día (cada venta descuenta varios
 * insumos) y llenaba la memoria del navegador (~5 MB): la caja se trababa
 * con "exceeded the quota". En la caja solo se quedan los últimos días; lo
 * más viejo se guarda en la nube (colección aparte que la sincronización no
 * baja a los equipos) y las pantallas lo piden cuando consultan esas fechas.
 */

/** Días de kardex que se quedan en la caja */
export const KARDEX_LOCAL_DAYS = 2;

/** Colección de la nube con el kardex viejo (no empieza con "bpos_": la sincronización no la baja) */
export const KARDEX_ARCHIVE_COLLECTION = "archive:bpos_inventory_kardex";

type MovementLike = { id?: unknown; ingredientId?: unknown; createdAt?: unknown };

/** Desde cuándo se queda en la caja (a las 00:00 de hace KARDEX_LOCAL_DAYS días) */
export function localKardexCutoff(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - KARDEX_LOCAL_DAYS);
}

function timeOf(m: unknown) {
  const at = m && typeof m === "object" ? (m as MovementLike).createdAt : undefined;
  const t = typeof at === "string" ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? t : NaN;
}

/** Sin fecha válida va al final */
function sortTime(m: unknown) {
  const t = timeOf(m);
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}

/** Separa lo que se queda en la caja de lo que va a la nube (sin fecha válida, se queda) */
export function splitKardex<T>(list: T[], cutoff = localKardexCutoff()) {
  const keep: T[] = [];
  const old: T[] = [];
  for (const m of list) {
    const t = timeOf(m);
    if (Number.isFinite(t) && t < cutoff.getTime()) old.push(m);
    else keep.push(m);
  }
  return { keep, old };
}

/**
 * Id único de cada movimiento en la nube. Una compra o una venta guarda
 * varios renglones con el mismo id (uno por insumo); se distinguen por
 * insumo y fecha, y si aun así se repiten, por un contador. Siempre da el
 * mismo id para la misma lista: volver a subirla no duplica nada.
 */
export function archiveIds(list: unknown[]) {
  const seen = new Map<string, number>();
  return list.map((m) => {
    const o = (m && typeof m === "object" ? m : {}) as MovementLike;
    const base = `${String(o.id ?? "")}~${String(o.ingredientId ?? "")}~${String(o.createdAt ?? "")}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}~${n}`;
  });
}

/** Une el kardex de la caja con el de la nube, sin repetir, del más viejo al más nuevo */
export function mergeKardex<T>(local: T[], cloud: unknown[]): T[] {
  if (!cloud.length) return local;
  // Lo de la nube que la caja todavía tiene (mismo id, insumo y fecha) no se repite
  const localIds = new Set(archiveIds(local));
  const cloudIds = archiveIds(cloud);
  const extra = cloud.filter((m, i) => m && typeof m === "object" && !localIds.has(cloudIds[i])) as T[];
  if (!extra.length) return local;
  return [...extra, ...local]
    .map((m, i) => [m, i] as const)
    .sort((a, b) => sortTime(a[0]) - sortTime(b[0]) || a[1] - b[1])
    .map(([m]) => m);
}

/** Pedazo de un rango que cae antes del corte de la caja (null si todo está en la caja) */
export function archivedKardexPart(from: Date | null | undefined, to: Date | null | undefined, cutoff = localKardexCutoff()) {
  if (!from || !(from.getTime() < cutoff.getTime())) return null;
  const end = to && to.getTime() < cutoff.getTime() ? to : cutoff;
  return { from, to: end };
}
