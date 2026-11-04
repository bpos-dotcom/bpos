"use client";
/**
 * Finanzas: cómo va subiendo el periodo (acumulado día por día) contra el
 * periodo anterior en los mismos días. Rojo continuo = este periodo; gris
 * punteado = el anterior. Al pasar el dedo o el mouse se ven los dos valores.
 */
import { useRef, useState } from "react";

type Props = {
  /** Etiqueta de cada día del eje (ej. "Lun 3") */
  labels: string[];
  /** Acumulado de este periodo; null = día que todavía no llega */
  current: (number | null)[];
  /** Acumulado del periodo anterior, mismo número de día */
  previous: (number | null)[];
  currentName: string;
  previousName: string;
  format: (n: number) => string;
  /** Lo de ese día solo (no acumulado), para el recuadro al pasar el dedo */
  currentDay?: (number | null)[];
  previousDay?: (number | null)[];
  /** Título de lo del día ("Ventas del día") */
  dayName?: string;
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

export function FinanceChart({ labels, current, previous, currentName, previousName, format, currentDay, previousDay, dayName }: Props) {
  const box = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(labels.length, 1);
  const values = [...current, ...previous].filter((v): v is number => v !== null);
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
  const lastCurrent = current.reduce<number>((last, v, i) => (v === null ? last : i), -1);

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  }

  const tip = hover !== null ? { i: hover, cur: current[hover], prev: previous[hover] } : null;
  const diff = tip && tip.cur !== null && tip.cur !== undefined && tip.prev !== null && tip.prev !== undefined ? tip.cur - tip.prev : null;

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-xs font-bold text-zinc-300">
        <span className="flex items-center gap-2">
          <svg width="22" height="8" aria-hidden>
            <line x1="1" y1="4" x2="21" y2="4" style={{ stroke: "var(--color-red-500)" }} strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          {currentName}
        </span>
        <span className="flex items-center gap-2">
          <svg width="22" height="8" aria-hidden>
            <line x1="1" y1="4" x2="21" y2="4" style={{ stroke: "var(--color-zinc-500)" }} strokeWidth="2" strokeDasharray="4 3" strokeLinecap="round" />
          </svg>
          {previousName}
        </span>
      </div>
      <div className="relative">
        <svg
          ref={box}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none select-none"
          role="img"
          aria-label={`${currentName} contra ${previousName}`}
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
          <path d={path(previous)} fill="none" style={{ stroke: "var(--color-zinc-500)" }} strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" />
          <path d={path(current)} fill="none" style={{ stroke: "var(--color-red-500)" }} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {lastCurrent >= 0 && current[lastCurrent] !== null && (
            <circle cx={x(lastCurrent)} cy={y(current[lastCurrent]!)} r="4.5" style={{ fill: "var(--color-red-500)", stroke: "var(--color-zinc-950)" }} strokeWidth="2" />
          )}
          {tip && (
            <g pointerEvents="none">
              <line x1={x(tip.i)} x2={x(tip.i)} y1={PAD.top} y2={H - PAD.bottom} style={{ stroke: "var(--color-zinc-500)" }} strokeWidth="1" />
              {tip.prev !== null && tip.prev !== undefined && <circle cx={x(tip.i)} cy={y(tip.prev)} r="4" style={{ fill: "var(--color-zinc-500)", stroke: "var(--color-zinc-950)" }} strokeWidth="2" />}
              {tip.cur !== null && tip.cur !== undefined && <circle cx={x(tip.i)} cy={y(tip.cur)} r="4.5" style={{ fill: "var(--color-red-500)", stroke: "var(--color-zinc-950)" }} strokeWidth="2" />}
            </g>
          )}
        </svg>
        {tip && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-44 rounded-xl border border-zinc-700 bg-zinc-950/95 px-3 py-2 text-xs shadow-lg"
            style={x(tip.i) > W / 2 ? { right: `${((W - x(tip.i)) / W) * 100 + 2}%` } : { left: `${(x(tip.i) / W) * 100 + 2}%` }}
          >
            <p className="font-black text-white">Día {tip.i + 1} · {labels[tip.i]}</p>
            {dayName && (
              <>
                <p className="mt-1.5 text-[10px] font-black uppercase tracking-wider text-zinc-500">{dayName}</p>
                <p className="flex justify-between gap-3 text-zinc-300">
                  <span>{currentName}</span>
                  <b className="text-white">{currentDay?.[tip.i] === null || currentDay?.[tip.i] === undefined ? "—" : format(currentDay[tip.i]!)}</b>
                </p>
                <p className="flex justify-between gap-3 text-zinc-400">
                  <span>{previousName}</span>
                  <b>{previousDay?.[tip.i] === null || previousDay?.[tip.i] === undefined ? "—" : format(previousDay[tip.i]!)}</b>
                </p>
              </>
            )}
            <p className="mt-1.5 text-[10px] font-black uppercase tracking-wider text-zinc-500">Acumulado hasta ese día</p>
            <p className="flex justify-between gap-3 text-zinc-300">
              <span>{currentName}</span>
              <b className="text-white">{tip.cur === null || tip.cur === undefined ? "—" : format(tip.cur)}</b>
            </p>
            <p className="flex justify-between gap-3 text-zinc-400">
              <span>{previousName}</span>
              <b>{tip.prev === null || tip.prev === undefined ? "—" : format(tip.prev)}</b>
            </p>
            {diff !== null && (
              <p className={`mt-1 font-black ${diff >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {diff >= 0 ? "▲" : "▼"} {format(Math.abs(diff))} {diff >= 0 ? "arriba" : "abajo"} en el acumulado
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
