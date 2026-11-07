/**
 * Asesor con IA: cada cuánto puede pedir cada negocio un análisis nuevo
 * (diario, cada 3 días o cada semana). Lo elige el dueño de B-POS en
 * Configuración → Administrador → Claves de IA → Asesor; el servidor lo hace
 * respetar (app/api/ai/asesor). Días de calendario, hora de México. Sin
 * dependencias del servidor: lo usan la caja y Vercel.
 */
export type RefreshDays = 1 | 3 | 7;

export const REFRESH_OPTIONS: { value: RefreshDays; label: string; text: string }[] = [
  { value: 1, label: "Diario", text: "una vez al día" },
  { value: 3, label: "Cada 3 días", text: "cada 3 días" },
  { value: 7, label: "Cada semana", text: "una vez por semana" },
];

export const asRefreshDays = (v: unknown): RefreshDays => (Number(v) === 3 ? 3 : Number(v) === 7 ? 7 : 1);

/** Fecha de México (YYYY-MM-DD) */
export const mexicoDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** Desde qué día (YYYY-MM-DD, México) se puede pedir otro análisis; null si ya se puede */
export function nextAnalysisDay(lastAt: string | null | undefined, days: RefreshDays, now = new Date()) {
  if (!lastAt || !Number.isFinite(Date.parse(lastAt))) return null;
  const next = new Date(`${mexicoDay(new Date(lastAt))}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  const day = next.toISOString().slice(0, 10);
  return mexicoDay(now) >= day ? null : day;
}

/** "sáb 14 nov" para una fecha YYYY-MM-DD */
export const dayLabel = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(/\./g, "");
