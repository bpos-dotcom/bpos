/**
 * La caja guarda en su memoria solo las ventas de este mes y del mes pasado
 * (lo que se ve en Finanzas sin ir más atrás). Lo más viejo se queda en la
 * nube y se consulta cuando se pide en Finanzas, Reportes, Historial o
 * Clientes. Las cuentas abiertas (mesas, en espera) nunca se quitan.
 */

/** Primer día del mes pasado, 00:00: lo anterior se consulta en la nube */
export function localOrdersCutoff(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth() - 1, 1);
}

type OrderLike = { id?: unknown; createdAt?: unknown; pendingPayment?: unknown };

/** Venta cerrada de antes del corte (ya no hace falta en la memoria de la caja) */
export function isArchivedOrder(order: unknown, cutoff = localOrdersCutoff()) {
  if (!order || typeof order !== "object") return false;
  const o = order as OrderLike;
  if (o.pendingPayment === true) return false;
  if (typeof o.createdAt !== "string") return false;
  const at = new Date(o.createdAt).getTime();
  return Number.isFinite(at) && at < cutoff.getTime();
}

/**
 * Separa las ventas viejas que ya están en la nube. `synced(order)` dice si
 * esa venta ya se subió tal cual (si no, se queda hasta subirse).
 */
export function pruneArchivedOrders<T>(list: T[], cutoff: Date, synced: (order: T) => boolean) {
  const removedIds: string[] = [];
  const kept = list.filter((order) => {
    if (!isArchivedOrder(order, cutoff) || !synced(order)) return true;
    removedIds.push(String((order as OrderLike).id));
    return false;
  });
  return { kept, removedIds };
}

/** Une las ventas de la caja con las de la nube sin repetir (gana la de la caja) */
export function mergeOrders<T>(local: T[], cloud: unknown[]): T[] {
  if (!cloud.length) return local;
  const seen = new Set(local.map((o) => String((o as OrderLike).id)));
  const extra = cloud.filter((o) => o && typeof o === "object" && !seen.has(String((o as OrderLike).id))) as T[];
  if (!extra.length) return local;
  // En el mismo orden que la caja: de la más vieja a la más nueva
  return [...extra, ...local].sort((a, b) => String((a as OrderLike).createdAt ?? "").localeCompare(String((b as OrderLike).createdAt ?? "")));
}

/** Pedazo de un rango que cae antes del corte (null si todo está en la caja) */
export function archivedPart(from: Date | null | undefined, to: Date | null | undefined, cutoff = localOrdersCutoff()) {
  if (!from || !(from.getTime() < cutoff.getTime())) return null;
  const end = to && to.getTime() < cutoff.getTime() ? to : cutoff;
  return { from, to: end };
}
