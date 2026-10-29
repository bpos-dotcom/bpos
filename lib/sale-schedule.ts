/**
 * Horario de venta de un producto (Configuración → Productos): días de la
 * semana y horas en que se puede vender en el POS. Ej. "2 hamburguesas x $140"
 * solo los viernes. Sin horario se vende siempre. Delivery no se bloquea
 * (el pedido ya lo aceptó la plataforma).
 */
export type SaleSchedule = {
  /** 0 = domingo … 6 = sábado. Vacío = todos los días. */
  days: number[];
  /** "HH:MM" o "" (todo el día). Si "desde" es mayor que "hasta" cruza la medianoche. */
  from: string;
  to: string;
};

export const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
export const DAY_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const minutes = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
  return m ? Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2])) : null;
};

/** Sin días ni horas = no hay horario (se vende siempre). */
export function cleanSchedule(schedule?: SaleSchedule | null): SaleSchedule | undefined {
  if (!schedule) return undefined;
  const days = Array.from(new Set(schedule.days.filter((d) => d >= 0 && d <= 6))).sort();
  const from = minutes(schedule.from) === null ? "" : schedule.from;
  const to = minutes(schedule.to) === null ? "" : schedule.to;
  const allDays = days.length === 0 || days.length === 7;
  const allHours = (!from && !to) || (from && from === to);
  if (allDays && allHours) return undefined;
  return { days: allDays ? [] : days, from: allHours ? "" : from, to: allHours ? "" : to };
}

/** ¿Se puede vender en este momento? */
export function isOnSale(schedule: SaleSchedule | undefined, now = new Date()) {
  const s = cleanSchedule(schedule);
  if (!s) return true;
  const day = now.getDay();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const dayOk = (d: number) => s.days.length === 0 || s.days.includes(d);
  const from = minutes(s.from) ?? 0;
  const to = minutes(s.to) ?? 24 * 60;
  if (!s.from && !s.to) return dayOk(day);
  if (from <= to) return dayOk(day) && nowMin >= from && nowMin < to;
  // Cruza la medianoche: de "desde" hasta las 23:59 del día marcado, y de 00:00 a "hasta" del día siguiente
  if (nowMin >= from) return dayOk(day);
  return nowMin < to && dayOk((day + 6) % 7);
}

/** Texto corto: "Solo Vie · 12:00 a 22:00" */
export function scheduleLabel(schedule?: SaleSchedule) {
  const s = cleanSchedule(schedule);
  if (!s) return "";
  const days = s.days.length ? `Solo ${s.days.map((d) => DAY_SHORT[d]).join(", ")}` : "Todos los días";
  const hours = s.from || s.to ? ` · ${s.from || "00:00"} a ${s.to || "24:00"}` : "";
  return `${days}${hours}`;
}
