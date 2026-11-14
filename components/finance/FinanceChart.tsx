"use client";
/**
 * Finanzas: cómo va subiendo el periodo (acumulado día por día) contra el
 * periodo anterior en los mismos días. Cada serie (ej. ingresos locales en
 * verde y de apps en naranja) va en línea continua; la misma serie del
 * periodo anterior, punteada. Al pasar el dedo o el mouse se ven los valores
 * de ese día.
 *
 * El botón ⛶ la abre en pantalla completa: zoom con dos dedos, la rueda del
 * mouse o los botones + y −, se mueve arrastrando (o con ◀ ▶) y cada línea
 * de la leyenda se prende o se apaga para distinguir cuál es cuál.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clampView, panView, visibleRange, zoomView, type ChartView } from "@/lib/chart-view";

export type ChartSeries = {
  name: string;
  /** Color CSS de la línea (ej. "var(--color-emerald-500)") */
  color: string;
  /** Acumulado de este periodo; null = día que todavía no llega */
  current: (number | null)[];
  /** Acumulado del periodo anterior, mismo número de día */
  previous: (number | null)[];
  /** Lo de ese día solo (no acumulado), para el recuadro al pasar el dedo */
  currentDay?: (number | null)[];
  previousDay?: (number | null)[];
  /** De dónde vino lo de ese día en este periodo (Efectivo $372 · Tarjeta $269...) */
  breakdown?: ({ label: string; amount: number }[] | null)[];
};

type Props = {
  /** Etiqueta de cada día del eje (ej. "Lun 3") */
  labels: string[];
  series: ChartSeries[];
  currentName: string;
  previousName: string;
  format: (n: number) => string;
  /** Título de lo del día ("Ventas del día") */
  dayName?: string;
  /** Debajo de la leyenda (ej. el mejor día) */
  footer?: React.ReactNode;
};

const PAD = { top: 16, right: 16, bottom: 28, left: 64 };

/** Números redondos para el eje (0, 5 mil, 10 mil...) */
function ticks(min: number, max: number, count = 4) {
  const span = max - min || 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) || raw;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  const end = Math.ceil(max / step) * step;
  for (let v = start; v <= end + step * 0.001; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

const has = (v: number | null | undefined): v is number => v !== null && v !== undefined;

type PlotProps = Omit<Props, "footer"> & {
  W: number;
  H: number;
  view: ChartView;
  showPrevious: boolean;
  big?: boolean;
  /** Pantalla completa: zoom y arrastrar */
  onView?: (v: ChartView) => void;
};

function Plot({ labels, series, currentName, previousName, format, dayName, W, H, view, showPrevious, big, onView }: PlotProps) {
  const box = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ view: ChartView; dist: number; cx: number } | null>(null);
  const drag = useRef<{ view: ChartView; x: number } | null>(null);
  const n = Math.max(labels.length, 1);
  const plotW = W - PAD.left - PAD.right;
  const [from, to] = visibleRange(view, n);
  const inView = (list: (number | null)[]) => list.slice(from, to + 1);
  const values = series.flatMap((s) => [...inView(s.current), ...(showPrevious ? inView(s.previous) : [])]).filter(has);
  // Con zoom la escala empieza cerca de lo más bajo que se ve: así se separan las líneas
  const zoomedIn = view.end - view.start < n - 1 - 0.01;
  const low = values.length ? Math.min(...values) : 0;
  const high = Math.max(1, ...values);
  const yTicks = ticks(zoomedIn && low > 0 ? Math.max(0, low - (high - low) * 0.1) : Math.min(0, low), high, big ? 6 : 4);
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];
  const span = view.end - view.start;
  const x = (i: number) => PAD.left + (n === 1 ? plotW / 2 : ((i - view.start) / (span || 1)) * plotW);
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - PAD.top - PAD.bottom);
  const path = (list: (number | null)[]) =>
    list
      .map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
      .reduce<string[]>((acc, p, i, all) => (p ? [...acc, `${all[i - 1] ? "L" : "M"}${p}`] : acc), [])
      .join(" ");
  // Etiquetas del eje sin amontonarse: una cada ~90 px
  const shown = to - from + 1;
  const every = Math.max(1, Math.ceil(shown / Math.max(2, Math.floor(plotW / 90))));
  const lastCurrent = (list: (number | null)[]) => list.reduce<number>((last, v, i) => (v === null ? last : i), -1);
  const several = series.length > 1;
  const sum = (pick: (s: ChartSeries) => number | null | undefined) => {
    const got = series.map(pick).filter(has);
    return got.length ? got.reduce((a, b) => a + b, 0) : null;
  };
  const font = big ? 13 : 11;
  const lineW = big ? 3 : 2.5;
  const prevW = big ? 2.5 : 2;

  // Rueda del mouse: zoom donde está el cursor (solo pantalla completa)
  useEffect(() => {
    const el = box.current;
    if (!el || !onView) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const at = (((e.clientX - r.left) / r.width) * W - PAD.left) / plotW;
      onView(zoomView(view, e.deltaY > 0 ? 1.2 : 1 / 1.2, at, n));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [onView, view, W, plotW, n]);

  /** Posición del puntero en el plano (0 = orilla izquierda, 1 = derecha) */
  const fraction = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    return r ? (((clientX - r.left) / r.width) * W - PAD.left) / plotW : 0;
  };

  function showDay(clientX: number) {
    const i = Math.round(view.start + fraction(clientX) * span);
    setHover(Math.max(from, Math.min(to, i)));
  }

  function onDown(e: React.PointerEvent<SVGSVGElement>) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (onView && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { view, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2 };
      setHover(null);
      return;
    }
    if (onView && e.pointerType === "mouse") drag.current = { view, x: e.clientX };
    showDay(e.clientX);
  }

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (onView && g && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const cx = (a.x + b.x) / 2;
      const zoomed = zoomView(g.view, g.dist / dist, fraction(g.cx), n);
      onView(panView(zoomed, -((fraction(cx) - fraction(g.cx)) * (zoomed.end - zoomed.start)), n));
      return;
    }
    const d = drag.current;
    if (onView && d && e.buttons === 1 && Math.abs(e.clientX - d.x) > 4) {
      onView(panView(d.view, -(fraction(e.clientX) - fraction(d.x)) * (d.view.end - d.view.start), n));
    }
    if (!gesture.current) showDay(e.clientX);
  }

  function onUp(e: React.PointerEvent<SVGSVGElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    drag.current = null;
  }

  const tip = hover;
  const curTotal = tip === null ? null : sum((s) => s.current[tip]);
  const prevTotal = tip === null ? null : sum((s) => s.previous[tip]);
  const diff = has(curTotal) && has(prevTotal) ? curTotal - prevTotal : null;

  /** Renglón del recuadro: nombre de la serie, este periodo y el anterior */
  const row = (key: string, name: React.ReactNode, now: number | null | undefined, before: number | null | undefined, strong = false) => (
    <p key={key} className={`grid grid-cols-[1fr_auto_auto] gap-3 ${strong ? "font-black text-white" : "text-zinc-300"}`}>
      <span>{name}</span>
      <b className="text-right text-white">{has(now) ? format(now) : "—"}</b>
      <span className="text-right text-zinc-500">{has(before) ? format(before) : "—"}</span>
    </p>
  );
  const dot = (color: string) => <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: color }} />;
  const clipId = `plot-${big ? "big" : "small"}`;

  return (
    <div className="relative">
      <svg
        ref={box}
        viewBox={`0 0 ${W} ${H}`}
        className={`w-full touch-none select-none ${big ? "h-full" : "h-auto"} ${onView && span < n - 1 ? "cursor-grab" : ""}`}
        role="img"
        aria-label={`${series.map((s) => s.name).join(" y ")}: ${currentName} contra ${previousName}`}
        onPointerMove={onMove}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={(e) => {
          onUp(e);
          setHover(null);
        }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD.left - 6} y={0} width={plotW + 12} height={H} />
          </clipPath>
        </defs>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} style={{ stroke: t === 0 ? "var(--color-zinc-600)" : "var(--color-zinc-800)" }} strokeWidth="1" />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize={font} style={{ fill: "var(--color-zinc-500)" }}>
              {format(t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          i >= from && i <= to && ((i - from) % every === 0 || i === to) && !(i === to && i !== from && (i - from) % every !== 0 && (i - from) % every < every / 2) ? (
            <text key={i} x={x(i)} y={H - 8} textAnchor={i === from && view.start <= 0 ? "start" : i === to && view.end >= n - 1 ? "end" : "middle"} fontSize={font} style={{ fill: "var(--color-zinc-500)" }}>
              {l}
            </text>
          ) : null
        )}
        <g clipPath={`url(#${clipId})`}>
          {showPrevious &&
            series.map((s) => (
              <path key={`prev-${s.name}`} d={path(s.previous)} fill="none" style={{ stroke: s.color }} opacity="0.75" strokeWidth={prevW} strokeDasharray="7 5" strokeLinecap="round" strokeLinejoin="round" />
            ))}
          {series.map((s) => (
            <path key={`cur-${s.name}`} d={path(s.current)} fill="none" style={{ stroke: s.color }} strokeWidth={lineW} strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {series.map((s) => {
            const last = lastCurrent(s.current);
            return last >= 0 && has(s.current[last]) ? <circle key={`end-${s.name}`} cx={x(last)} cy={y(s.current[last]!)} r="4.5" style={{ fill: s.color, stroke: "var(--color-zinc-950)" }} strokeWidth="2" /> : null;
          })}
          {big &&
            series.map((s) =>
              s.current.map((v, i) => (has(v) && i >= from && i <= to ? <circle key={`pt-${s.name}-${i}`} cx={x(i)} cy={y(v)} r="3" style={{ fill: s.color }} /> : null))
            )}
        </g>
        {tip !== null && (
          <g pointerEvents="none">
            <line x1={x(tip)} x2={x(tip)} y1={PAD.top} y2={H - PAD.bottom} style={{ stroke: "var(--color-zinc-500)" }} strokeWidth="1" />
            {series.map((s) => (
              <g key={`tip-${s.name}`}>
                {showPrevious && has(s.previous[tip]) && <circle cx={x(tip)} cy={y(s.previous[tip]!)} r="4" style={{ fill: s.color, stroke: "var(--color-zinc-950)" }} opacity="0.6" strokeWidth="2" />}
                {has(s.current[tip]) && <circle cx={x(tip)} cy={y(s.current[tip]!)} r="4.5" style={{ fill: s.color, stroke: "var(--color-zinc-950)" }} strokeWidth="2" />}
              </g>
            ))}
          </g>
        )}
      </svg>
      {tip !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 min-w-56 rounded-xl border border-zinc-700 bg-zinc-950/95 px-3 py-2 text-xs shadow-lg"
          style={x(tip) > W / 2 ? { right: `${((W - x(tip)) / W) * 100 + 2}%` } : { left: `${(x(tip) / W) * 100 + 2}%` }}
        >
          <p className="font-black text-white">Día {tip + 1} · {labels[tip]}</p>
          <p className="mt-1 grid grid-cols-[1fr_auto_auto] gap-3 text-[10px] font-bold text-zinc-500">
            <span />
            <span className="text-right">{currentName}</span>
            <span className="text-right">{previousName}</span>
          </p>
          {dayName && (
            <>
              <p className="mt-1 text-[10px] font-black uppercase tracking-wider text-zinc-500">{dayName}</p>
              {series.map((s) => (
                <div key={`day-${s.name}`}>
                  {row(s.name, <>{dot(s.color)}{s.name}</>, s.currentDay?.[tip], s.previousDay?.[tip])}
                  {(s.breakdown?.[tip]?.length || 0) > 0 && (
                    <div className="mb-1 ml-3 border-l border-zinc-700 pl-2">
                      {s.breakdown![tip]!.map((b) => (
                        <p key={b.label} className="flex justify-between gap-3 text-zinc-400">
                          <span>{b.label}</span>
                          <span>{format(b.amount)}</span>
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {several && row("day-total", "Total", sum((s) => s.currentDay?.[tip]), sum((s) => s.previousDay?.[tip]), true)}
            </>
          )}
          <p className="mt-1.5 text-[10px] font-black uppercase tracking-wider text-zinc-500">Acumulado hasta ese día</p>
          {series.map((s) => row(`acc-${s.name}`, <>{dot(s.color)}{s.name}</>, s.current[tip], s.previous[tip]))}
          {several && row("acc-total", "Total", curTotal, prevTotal, true)}
          {diff !== null && (
            <p className={`mt-1 font-black ${diff >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {diff >= 0 ? "▲" : "▼"} {format(Math.abs(diff))} {diff >= 0 ? "arriba" : "abajo"} en el acumulado
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Leyenda: cada renglón se toca para prender o apagar su línea */
function Legend({
  series,
  hidden,
  toggle,
  showPrevious,
  togglePrevious,
  currentName,
  previousName,
}: {
  series: ChartSeries[];
  hidden: Set<string>;
  toggle: (name: string) => void;
  showPrevious: boolean;
  togglePrevious: () => void;
  currentName: string;
  previousName: string;
}) {
  const several = series.length > 1;
  const chip = (on: boolean) => `flex items-center gap-2 rounded-full border px-2.5 py-1 transition ${on ? "border-zinc-700 bg-black" : "border-zinc-800 opacity-40 line-through"}`;
  return (
    <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-zinc-300">
      {series.map((s) => (
        <button key={`leg-${s.name}`} type="button" onClick={() => toggle(s.name)} className={chip(!hidden.has(s.name))} aria-pressed={!hidden.has(s.name)} title="Toca para ocultar o mostrar esta línea">
          <svg width="22" height="8" aria-hidden>
            <line x1="1" y1="4" x2="21" y2="4" style={{ stroke: s.color }} strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          {s.name} ({currentName.toLowerCase()})
        </button>
      ))}
      <button type="button" onClick={togglePrevious} className={`${chip(showPrevious)} text-zinc-400`} aria-pressed={showPrevious} title="Toca para ocultar o mostrar las punteadas">
        <svg width="22" height="8" aria-hidden>
          <line x1="1" y1="4" x2="21" y2="4" style={{ stroke: "var(--color-zinc-400)" }} strokeWidth="2.5" strokeDasharray="5 4" strokeLinecap="round" />
        </svg>
        Punteada: {previousName.toLowerCase()}
        {several ? " (mismo color)" : ""}
      </button>
    </div>
  );
}

/** Tamaño real de un elemento (para dibujar la gráfica grande sin estirar las letras) */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

function FullScreen({ onClose, ...props }: Omit<Props, "footer"> & { onClose: () => void; hidden: Set<string>; toggle: (n: string) => void; showPrevious: boolean; togglePrevious: () => void }) {
  const { labels, hidden, toggle, showPrevious, togglePrevious, series } = props;
  const n = Math.max(labels.length, 1);
  const [view, setView] = useState<ChartView>({ start: 0, end: n - 1 });
  const [area, size] = useSize<HTMLDivElement>();
  const shell = useRef<HTMLDivElement>(null);

  // Pantalla completa del celular y, si se deja, acostado
  useEffect(() => {
    const el = shell.current;
    (async () => {
      try {
        await el?.requestFullscreen?.();
        await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.("landscape");
      } catch {
        // no todos los navegadores dejan; se ve igual en la ventana
      }
    })();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = prevOverflow;
      try {
        screen.orientation?.unlock?.();
      } catch {
        // sin bloqueo
      }
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, [onClose]);

  // Si el celular sale de pantalla completa (botón atrás), se cierra
  useEffect(() => {
    const change = () => {
      if (!document.fullscreenElement && shell.current?.dataset.wasFull) onClose();
      if (document.fullscreenElement) shell.current?.setAttribute("data-was-full", "1");
    };
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, [onClose]);

  const span = view.end - view.start;
  const zoomed = span < n - 1 - 0.01;
  const btn = "rounded-xl border border-zinc-700 bg-black px-3 py-2 text-sm font-black text-white disabled:opacity-30";
  const visible = series.filter((s) => !hidden.has(s.name));

  return (
    <div ref={shell} className="fixed inset-0 z-[120] flex flex-col bg-zinc-950 p-3 text-white sm:p-5" role="dialog" aria-modal="true" aria-label="Gráfica en pantalla completa">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-base font-black">📈 Cómo vamos</p>
        <div className="flex flex-wrap items-center gap-2">
          <button className={btn} onClick={() => setView(panView(view, -Math.max(1, span / 3), n))} disabled={!zoomed || view.start <= 0} aria-label="Mover a días anteriores">◀</button>
          <button className={btn} onClick={() => setView(zoomView(view, 1.5, 0.5, n))} disabled={!zoomed} aria-label="Alejar">−</button>
          <button className={btn} onClick={() => setView(zoomView(view, 1 / 1.5, 0.5, n))} disabled={span <= 2.01 || n < 3} aria-label="Acercar">+</button>
          <button className={btn} onClick={() => setView(panView(view, Math.max(1, span / 3), n))} disabled={!zoomed || view.end >= n - 1} aria-label="Mover a días siguientes">▶</button>
          {zoomed && (
            <button className={btn} onClick={() => setView({ start: 0, end: n - 1 })}>
              Ver todo
            </button>
          )}
          <button className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-black text-black" onClick={onClose} aria-label="Cerrar pantalla completa">
            ✕ Cerrar
          </button>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">Dos dedos o la rueda del mouse para acercar · arrastra para moverte · toca la leyenda para ocultar líneas</p>
      <div ref={area} className="mt-2 min-h-0 flex-1">
        {size.w > 0 && size.h > 0 && (
          <Plot {...props} series={visible} W={size.w} H={size.h} view={clampView(view, n)} showPrevious={showPrevious} big onView={setView} />
        )}
      </div>
      <Legend series={series} hidden={hidden} toggle={toggle} showPrevious={showPrevious} togglePrevious={togglePrevious} currentName={props.currentName} previousName={props.previousName} />
    </div>
  );
}

export function FinanceChart({ footer, ...props }: Props) {
  const { labels, series } = props;
  const n = Math.max(labels.length, 1);
  const [full, setFull] = useState(false);
  const close = useCallback(() => setFull(false), []);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showPrevious, setShowPrevious] = useState(true);
  const togglePrevious = useCallback(() => setShowPrevious((v) => !v), []);
  const toggle = (name: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const visible = series.filter((s) => !hidden.has(s.name));

  return (
    <div>
      <div className="-mt-1 mb-1 flex justify-end">
        <button
          type="button"
          onClick={() => setFull(true)}
          className="rounded-lg border border-zinc-700 bg-black px-2 py-1 text-xs font-black text-zinc-200 hover:border-orange-500 hover:text-orange-400"
          aria-label="Ver la gráfica en pantalla completa"
          title="Ver en pantalla completa (zoom)"
        >
          ⛶ Ampliar
        </button>
      </div>
      <Plot {...props} series={visible} W={720} H={200} view={{ start: 0, end: n - 1 }} showPrevious={showPrevious} />
      <Legend series={series} hidden={hidden} toggle={toggle} showPrevious={showPrevious} togglePrevious={togglePrevious} currentName={props.currentName} previousName={props.previousName} />
      {footer}
      {full && createPortal(<FullScreen {...props} onClose={close} hidden={hidden} toggle={toggle} showPrevious={showPrevious} togglePrevious={togglePrevious} />, document.body)}
    </div>
  );
}
