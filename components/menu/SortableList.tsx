"use client";
/**
 * Lista que se acomoda arrastrando (con el dedo o el mouse, desde la
 * agarradera ⠿) o con las flechas ↑ ↓. Mientras se arrastra solo cambia en
 * pantalla; al soltar se llama onChange una vez (un solo guardado).
 */
import { useRef, useState } from "react";

type Props<T> = {
  items: T[];
  keyOf: (item: T) => string;
  render: (item: T, index: number) => React.ReactNode;
  onChange: (next: T[]) => void;
  label: (item: T) => string;
  className?: string;
};

export function SortableList<T>({ items, keyOf, render, onChange, label, className = "" }: Props<T>) {
  const [draft, setDraft] = useState<T[] | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const list = draft ?? items;

  const move = (from: number, to: number) => {
    if (to < 0 || to >= list.length || from === to) return list;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  };

  function onPointerMove(e: React.PointerEvent) {
    if (!dragKey || !draft) return;
    const from = draft.findIndex((i) => keyOf(i) === dragKey);
    // El renglón cuyo centro queda más cerca del dedo es el nuevo lugar
    let to = from;
    let best = Infinity;
    draft.forEach((item, i) => {
      const r = rows.current.get(keyOf(item))?.getBoundingClientRect();
      if (!r) return;
      const d = Math.abs(e.clientY - (r.top + r.height / 2));
      if (d < best) {
        best = d;
        to = i;
      }
    });
    if (to !== from) setDraft(move(from, to));
  }

  function finish() {
    if (draft && draft.some((item, i) => keyOf(item) !== keyOf(items[i]))) onChange(draft);
    setDraft(null);
    setDragKey(null);
  }

  return (
    <ol className={`space-y-2 ${className}`} onPointerMove={onPointerMove} onPointerUp={finish} onPointerCancel={finish}>
      {list.map((item, i) => {
        const key = keyOf(item);
        return (
          <li
            key={key}
            ref={(el) => {
              if (el) rows.current.set(key, el);
              else rows.current.delete(key);
            }}
            className={`flex items-center gap-2 rounded-2xl border bg-black px-2 py-2 ${dragKey === key ? "relative z-10 border-orange-500 shadow-lg shadow-orange-500/20" : "border-zinc-800"}`}
          >
            <span
              role="button"
              aria-label={`Arrastrar ${label(item)}`}
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                setDraft(list);
                setDragKey(key);
              }}
              className="flex h-9 w-8 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-lg text-xl text-zinc-500 hover:bg-zinc-900 hover:text-white active:cursor-grabbing"
            >
              ⠿
            </span>
            <span className="w-6 shrink-0 text-center text-xs font-black text-zinc-500">{i + 1}</span>
            <div className="min-w-0 flex-1">{render(item, i)}</div>
            <button type="button" onClick={() => onChange(move(i, i - 1))} disabled={i === 0} aria-label={`Subir ${label(item)}`} className="rounded-xl border border-zinc-700 px-2.5 py-1 font-black hover:border-orange-500 disabled:opacity-30">
              ↑
            </button>
            <button type="button" onClick={() => onChange(move(i, i + 1))} disabled={i === list.length - 1} aria-label={`Bajar ${label(item)}`} className="rounded-xl border border-zinc-700 px-2.5 py-1 font-black hover:border-orange-500 disabled:opacity-30">
              ↓
            </button>
          </li>
        );
      })}
    </ol>
  );
}
