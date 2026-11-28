/**
 * Cuántos días guarda este equipo en su memoria (ventas y kardex).
 * En el navegador hay un tope de ~5 MB, así que se guardan pocos días; en la
 * caja local del Agent se guarda en disco y caben 30. Al pasarse al Agent
 * solo trae lo que tenía el navegador, así que los días completos van
 * creciendo desde ese momento hasta llegar a 30 (lo anterior, de la nube).
 */

/** 00:00 de `days` días antes de `d` */
export function midnightDaysAgo(d: Date, days: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - days);
}

/**
 * Desde cuándo están completas las cosas en este equipo.
 * `since`: cuándo empezó a ser caja local (null en el navegador).
 */
export function localCutoffFor(now: Date, days: number, browserDays: number, since: Date | null) {
  const base = midnightDaysAgo(now, days);
  if (!since) return base;
  const floor = midnightDaysAgo(since, browserDays);
  return floor.getTime() > base.getTime() ? floor : base;
}

/** Días completos que tiene el equipo con ese corte (para los letreros) */
export function daysCovered(now: Date, cutoff: Date) {
  return Math.round((midnightDaysAgo(now, 0).getTime() - cutoff.getTime()) / 86_400_000);
}
