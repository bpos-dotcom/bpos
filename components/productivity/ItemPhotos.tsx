"use client";
/** Fotos de cada tarea de una lista, con el nombre de la tarea y quién la hizo */
import type { TaskRecord } from "@/lib/productivity";

export function ItemPhotos({ record, onOpen }: { record: TaskRecord; onOpen: (url: string) => void }) {
  const photos = Object.entries(record.photos || {});
  if (!photos.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {photos.map(([item, url]) => (
        <button key={item} onClick={() => onOpen(url)} className="w-20 text-left" title={item}>
          {/* eslint-disable-next-line @next/next/no-img-element -- foto de evidencia */}
          <img src={url} alt={item} className="h-20 w-20 rounded-lg object-cover" />
          <span className="mt-0.5 block truncate text-[11px] font-bold text-zinc-300">{item}</span>
          {record.itemBy?.[item]?.by && <span className="block truncate text-[10px] text-zinc-500">{record.itemBy[item].by}</span>}
        </button>
      ))}
    </div>
  );
}
