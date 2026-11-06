"use client";
/** Productos → "Seleccionar foto": elegir una foto de la galería del negocio (Tu negocio → Estudio Fotográfico). */
import Link from "next/link";
import { useEffect, useState } from "react";
import { GALLERY_EVENT, getGallery, type GalleryPhoto } from "@/lib/photo-gallery";

export function GalleryPicker({ current, onPick, onClose }: { current?: string; onPick: (url: string) => void; onClose: () => void }) {
  // Solo se abre en el navegador (al tocar el botón): se puede leer la galería de una vez
  const [photos, setPhotos] = useState<GalleryPhoto[]>(getGallery);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const load = () => setPhotos(getGallery());
    window.addEventListener(GALLERY_EVENT, load);
    return () => window.removeEventListener(GALLERY_EVENT, load);
  }, []);

  const q = query.trim().toLowerCase();
  const shown = q ? photos.filter((p) => p.name.toLowerCase().includes(q)) : photos;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-3 sm:items-center" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-zinc-800 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Seleccionar foto de la galería">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xl font-black text-white">🖼️ Seleccionar foto</p>
            <p className="text-sm text-zinc-400">De tu galería en Tu negocio → Estudio Fotográfico.</p>
          </div>
          <button onClick={onClose} className="rounded-xl border border-zinc-800 px-3 py-1 font-black" aria-label="Cerrar">
            ✕
          </button>
        </div>
        {photos.length > 6 && (
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 Buscar foto" className="mt-4 w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white" />
        )}
        {photos.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-zinc-700 p-6 text-center text-sm text-zinc-400">
            Todavía no hay fotos en tu galería.{" "}
            <Link href="/configuracion/estudio-ia" className="font-black text-violet-300 underline">
              Sube y mejora fotos en Estudio Fotográfico
            </Link>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {shown.map((p) => (
              <button
                key={p.id}
                onClick={() => onPick(p.url)}
                className={`overflow-hidden rounded-2xl border bg-black text-left transition hover:border-orange-500 ${p.url === current ? "border-orange-500" : "border-zinc-800"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- fotos del negocio en Supabase Storage */}
                <img src={p.url} alt={p.name} className="aspect-square w-full object-cover" loading="lazy" />
                <span className="block truncate px-3 pt-2 text-sm font-bold text-white">{p.name}</span>
                {/* Solo la ve el restaurante: no va en la foto ni en el menú */}
                <span className="block px-3 pb-2 text-xs font-black text-violet-300">{p.enhanced ? "Mejorada por B-POS IA ✨" : " "}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
