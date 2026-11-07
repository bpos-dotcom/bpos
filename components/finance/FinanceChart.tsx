"use client";
/**
 * Finanzas: cómo va subiendo el periodo (acumulado día por día) contra el
 * periodo anterior en los mismos días. Cada serie (ej. ingresos locales en
 * verde y de apps en naranja) va en línea continua; la misma serie del
 * periodo anterior, punteada y más tenue. Al pasar el dedo o el mouse se ven
 * los valores de ese día.
 */
import { useRef, useState } from "react";

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

const W = 720;
const H = 200;
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

export function FinanceChart({ labels, series, currentName, previousName, format, dayName, footer }: Props) {
  const box = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(labels.length, 1);
  const values = series.flatMap((s) => [...s.current, ...s.previous]).filter(has);
  const yTicks = ticks(Math.min(0, ...values), Math.max(1, ...values));
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];
  const x = (i: number) => PAD.left + (n === 1 ? (W - PAD.left - PAD.right) / 2 : (i / (n - 1)) * (W - PAD.left - PAD.right));
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - PAD.top - PAD.bottom);
  const path = (list: (number | null)[]) =>
    list
      .map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
      .reduce<string[]>((acc, p, i, all) => (p ? [...acc, `${all[i - 1] ? "L" : "M"}${p}`] : acc), [])
      .join(" ");
  // Etiquetas del eje sin amontonarse: unas 7 como máximo
  const every = Math.max(1, Math.ceil(n / 7));
  const lastCurrent = (list: (number | null)[]) => list.reduce<number>((last, v, i) => (v === null ? last : i), -1);
  const several = series.length > 1;
  const sum = (pick: (s: ChartSeries) => number | null | undefined) => {
    const got = series.map(pick).filter(has);
    return got.length ? got.reduce((a, b) => a + b, 0) : null;
  };

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
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

  return (
    <div>
      <div className="relative">
        <svg
          ref={box}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none select-none"
          role="img"
          aria-label={`${series.map((s) => s.name).join(" y ")}: ${currentName} contra ${previousName}`}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} style={{ stroke: t === 0 ? "var(--color-zinc-600)" : "var(--color-zinc-800)" }} strokeWidth="1" />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" style={{ fill: "var(--color-zinc-500)" }}>
                {format(t)}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            i % every === 0 || i === n - 1 ? (
              <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize="11" style={{ fill: "var(--color-zinc-500)" }}>
                {l}
              </text>
            ) : null
          )}
          {series.map((s) => (
            <path key={`prev-${s.name}`} d={path(s.previous)} fill="none" style={{ stroke: s.color }} opacity="0.45" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {series.map((s) => (
            <path key={`cur-${s.name}`} d={path(s.current)} fill="none" style={{ stroke: s.color }} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {series.map((s) => {
            const last = lastCurrent(s.current);
            return last >= 0 && has(s.current[last]) ? <circle key={`end-${s.name}`} cx={x(last)} cy={y(s.current[last]!)} r="4.5" style={{ fill: s.color, stroke: "var(--color-zinc-950)" }} strokeWidth="2" /> : null;
          })}
          {tip !== null && (
            <g pointerEvents="none">
              <line x1={x(tip)} x2={x(tip)} y1={PAD.top} y2={H - PAD.bottom} style={{ stroke: "var(--color-zinc-500)" }} strokeWidth="1" />
              {series.map((s) => (
                <g key={`tip-${s.name}`}>
                  {has(s.previous[tip]) && <circle cx={x(tip)} cy={y(s.previous[tip]!)} r="4" style={{ fill: s.color, stroke: "var(--color-zinc-950)" }} opacity="0.5" strokeWidth="2" />}
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
      {/* Leyenda: qué significa cada color */}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-zinc-300">
        {series.map((s) => (
          <span key={`leg-${s.name}`} className="flex items-center gap-2">
            <svg width="22" height="8" aria-hidden>
              <line x1="1" y1="4" x2="21" y2="4" style={{ stroke: s.color }} strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            {s.name} ({currentName.toLowerCase()})
          </span>
        ))}
        <span className="flex items-center gap-2 text-zinc-400">
          <svg width="22" height="8" aria-hidden>
            <line x1="1" y1="4" x2="21" y2="4" style={{ stroke: "var(--color-zinc-500)" }} strokeWidth="2" strokeDasharray="4 3" strokeLinecap="round" />
          </svg>
          Punteada: {previousName.toLowerCase()}{several ? " (mismo color)" : ""}
        </span>
      </div>
      {footer}
    </div>
  );
}
