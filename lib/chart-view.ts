/**
 * Ventana visible de una gráfica por días (zoom y mover). start y end son
 * índices de día con decimales: 0 = primer día, n - 1 = último. Siempre se
 * ven al menos 2 días de distancia (3 puntos) y nunca se sale del periodo.
 */
export type ChartView = { start: number; end: number };

export const MIN_SPAN = 2;

export function clampView(view: ChartView, n: number): ChartView {
  const last = Math.max(0, n - 1);
  if (last === 0) return { start: 0, end: 0 };
  const span = Math.min(last, Math.max(Math.min(MIN_SPAN, last), view.end - view.start));
  let start = Math.max(0, Math.min(view.start, last - span));
  if (!Number.isFinite(start)) start = 0;
  return { start, end: start + span };
}

/** Acercar (factor < 1) o alejar (factor > 1) dejando fijo el punto `at` (0 = orilla izquierda, 1 = derecha) */
export function zoomView(view: ChartView, factor: number, at: number, n: number): ChartView {
  const span = view.end - view.start;
  const pivot = view.start + Math.max(0, Math.min(1, at)) * span;
  const next = span * factor;
  const last = Math.max(0, n - 1);
  const size = Math.min(last, Math.max(Math.min(MIN_SPAN, last), next));
  const start = pivot - (pivot - view.start) * (size / (span || 1));
  return clampView({ start, end: start + size }, n);
}

/** Mover la ventana `days` días (negativo = hacia atrás) */
export function panView(view: ChartView, days: number, n: number): ChartView {
  return clampView({ start: view.start + days, end: view.end + days }, n);
}

/** Días enteros que caen dentro de la ventana */
export function visibleRange(view: ChartView, n: number): [number, number] {
  const last = Math.max(0, n - 1);
  return [Math.max(0, Math.ceil(view.start - 1e-6)), Math.min(last, Math.floor(view.end + 1e-6))];
}
