/**
 * BPOS Credits del Estudio de fotos: cada cuánto se reinician (al día, a la
 * semana o al mes; hora de México). Lo elige el dueño de B-POS en
 * Configuración → Administrador → Claves de IA → Estudio de fotos. Sin
 * dependencias del servidor: lo usan la caja y Vercel.
 */
export type CreditsPeriod = "dia" | "semana" | "mes";

export const CREDIT_PERIODS: { value: CreditsPeriod; label: string }[] = [
  { value: "dia", label: "Al día" },
  { value: "semana", label: "A la semana" },
  { value: "mes", label: "Al mes" },
];

export const asCreditsPeriod = (v: unknown): CreditsPeriod => (v === "semana" || v === "mes" ? v : "dia");

/** Textos para el periodo: "hoy / esta semana / este mes", cuándo se reinician y "al día / a la semana / al mes" */
export function periodTexts(period: CreditsPeriod) {
  if (period === "semana") return { now: "esta semana", reset: "el lunes a medianoche", per: "a la semana" };
  if (period === "mes") return { now: "este mes", reset: "el día 1 a medianoche", per: "al mes" };
  return { now: "hoy", reset: "a medianoche", per: "al día" };
}

/**
 * Fecha (YYYY-MM-DD, hora de México) con que se guardan los créditos usados
 * del periodo: el día, el lunes de la semana o el día 1 del mes.
 */
export function creditsKey(period: CreditsPeriod, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  if (period === "mes") return `${today.slice(0, 8)}01`;
  if (period === "semana") {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  return today;
}
