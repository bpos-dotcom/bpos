"use client";
/**
 * Plano de una zona del restaurante. Cada mesa va en su lugar (x, y en % del
 * plano); las que no tienen lugar se acomodan solas en cuadrícula.
 *
 * editable: se arrastran con el dedo o el mouse; al soltar se llama onMove
 * una sola vez (así solo se guarda, y se sincroniza, al terminar de mover).
 */
import { useRef, useState } from "react";
import type { Table } from "@/lib/tables";

type Spot = { x: number; y: number };

/** Lugar de cada mesa: el guardado o uno automático en cuadrícula */
export function planSpots(tables: Table[]): Map<string, Spot> {
  const spots = new Map<string, Spot>();
  const loose = tables.filter((t) => t.x === undefined || t.y === undefined);
  const cols = Math.max(1, Math.ceil(Math.sqrt(loose.length * 1.6)));
  const rows = Math.max(1, Math.ceil(loose.length / cols));
  loose.forEach((t, i) => spots.set(t.id, { x: ((i % cols) + 0.5) * (100 / cols), y: (Math.floor(i / cols) + 0.5) * (100 / rows) }));
  tables.forEach((t) => t.x !== undefined && t.y !== undefined && spots.set(t.id, { x: t.x, y: t.y }));
  return spots;
}

const sizeOf = (t: Table) =>
  t.shape === "larga" ? "h-12 w-24 rounded-2xl sm:h-16 sm:w-40" : t.shape === "redonda" ? "h-16 w-16 rounded-full sm:h-24 sm:w-24" : "h-16 w-16 rounded-2xl sm:h-24 sm:w-24";

/** Media mesa (la más grande, en pantalla ancha): así ninguna se sale del plano */
const halfW = (t: Table) => (t.shape === "larga" ? "5rem" : "3rem");
const halfH = (t: Table) => (t.shape === "larga" ? "2rem" : "3rem");

type Props = {
  tables: Table[];
  editable?: boolean;
  onMove?: (id: string, x: number, y: number) => void;
  onPick?: (table: Table) => void;
  /** Colores y contenido de cada mesa (en el POS: libre u ocupada) */
  look?: (table: Table) => { className: string; content: React.ReactNode };
};

export function FloorPlan({ tables, editable, onMove, onPick, look }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const spots = planSpots(tables);

  const toPercent = (clientX: number, clientY: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return null;
    const clamp = (v: number) => Math.max(4, Math.min(96, Math.round(v * 10) / 10));
    return { x: clamp(((clientX - r.left) / r.width) * 100), y: clamp(((clientY - r.top) / r.height) * 100) };
  };

  return (
    <div
      ref={box}
      className="relative w-full touch-none select-none overflow-hidden rounded-3xl border border-zinc-800 bg-black"
      style={{ aspectRatio: "16 / 10", minHeight: 260, backgroundImage: "radial-gradient(circle, rgba(161,161,170,0.18) 1px, transparent 1px)", backgroundSize: "24px 24px" }}
    >
      {tables.map((t) => {
        const spot = drag?.id === t.id ? drag : spots.get(t.id) || { x: 50, y: 50 };
        const view = look?.(t) ?? { className: "border-zinc-600 bg-zinc-900 text-white", content: <span className="text-lg font-black">{t.name}</span> };
        return (
          <button
            key={t.id}
            type="button"
            onPointerDown={(e) => {
              if (!editable) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              setDrag({ id: t.id, ...spot, moved: false });
            }}
            onPointerMove={(e) => {
              if (!editable || drag?.id !== t.id) return;
              const p = toPercent(e.clientX, e.clientY);
              if (p) setDrag({ id: t.id, ...p, moved: true });
            }}
            onPointerUp={() => {
              if (!editable || drag?.id !== t.id) return;
              if (drag.moved) onMove?.(t.id, drag.x, drag.y);
              setDrag(null);
            }}
            onPointerCancel={() => setDrag(null)}
            onClick={() => !editable && onPick?.(t)}
            style={{ left: `clamp(${halfW(t)}, ${spot.x}%, calc(100% - ${halfW(t)}))`, top: `clamp(${halfH(t)}, ${spot.y}%, calc(100% - ${halfH(t)}))` }}
            className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center border-2 p-1 text-center leading-tight shadow-lg ${sizeOf(t)} ${view.className} ${
              editable ? (drag?.id === t.id ? "z-10 cursor-grabbing ring-2 ring-orange-400" : "cursor-grab") : ""
            } ${t.active ? "" : "opacity-40"}`}
            aria-label={`Mesa ${t.name}`}
          >
            {view.content}
          </button>
        );
      })}
      {tables.length === 0 && <p className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">Sin mesas en esta zona.</p>}
    </div>
  );
}
