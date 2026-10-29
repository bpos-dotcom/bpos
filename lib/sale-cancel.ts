"use client";
/**
 * Ventas canceladas (bloque 11).
 *
 * Una venta cobrada ya no se borra: se cancela con motivo y queda guardada
 * (la nube además rechaza el borrado de ventas, ver 0004_bpos_bitacora.sql).
 * Las canceladas no cuentan en caja, reportes, dashboard ni KDS.
 */
export type CancellableSale = {
  cancelled?: boolean;
  cancelledAt?: string;
  cancelledBy?: string;
  cancelReason?: string;
};

export function isCancelled(sale: object | null | undefined) {
  return Boolean((sale as CancellableSale | null | undefined)?.cancelled);
}

/** La venta marcada como cancelada (no se borra). */
export function cancelSale<T extends CancellableSale>(sale: T, reason: string, by: string): T {
  return { ...sale, cancelled: true, cancelledAt: new Date().toISOString(), cancelledBy: by, cancelReason: reason.trim() };
}
