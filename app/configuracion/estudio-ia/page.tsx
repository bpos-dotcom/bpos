"use client";
/**
 * Tu negocio → Estudio IA: la galería de fotos del negocio. Al subir una foto
 * pregunta "¿Mejorar con IA?" (plan Max, BPOS Credits del día) y la guarda en
 * la galería; desde Productos → Seleccionar foto se usa en cualquier producto.
 */
import { useEffect, useMemo, useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import { ask } from "@/components/layout/Dialogs";
import { PhotoStudio, usePhotoCredits } from "@/components/products/PhotoStudio";
import { getAdminProducts } from "@/lib/admin";
import { GALLERY_EVENT, getGallery, removeFromGallery, type GalleryPhoto } from "@/lib/photo-gallery";
import type { Product } from "@/data/products";

type Source = { file: File } | { photo: GalleryPhoto };

export default function EstudioIaPage() {
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [source, setSource] = useState<Source | null>(null);
  const [query, setQuery] = useState("");
  const { status } = usePhotoCredits();

  useEffect(() => {
    const load = () => setPhotos(getGallery());
    load();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- datos del navegador: solo después de montar
    setProducts(getAdminProducts());
    window.addEventListener(GALLERY_EVENT, load);
    return () => window.removeEventListener(GALLERY_EVENT, load);
  }, []);

  // Qué productos usan cada foto
  const usedBy = useMemo(() => {
    const map = new Map<string, string[]>();
    products.forEach((p) => p.image && map.set(p.image, [...(map.get(p.image) || []), p.name]));
    return map;
  }, [products]);

  async function remove(photo: GalleryPhoto) {
    const uses = usedBy.get(photo.url) || [];
    const note = uses.length ? ` La usan ${uses.length} producto(s) (${uses.slice(0, 3).join(", ")}${uses.length > 3 ? "…" : ""}); ellos la conservan.` : "";
    if (!(await ask(`¿Quitar "${photo.name}" de la galería?${note}`, { ok: "Quitar" }))) return;
    removeFromGallery(photo.id);
  }

  const q = query.trim().toLowerCase();
  const shown = q ? photos.filter((p) => p.name.toLowerCase().includes(q)) : photos;
  const credits = status?.credits;

  return (
    <RequireRole allow={["Admin"]}>
      <AppShell title="Estudio IA" subtitle="Sube las fotos de tus platillos, mejóralas con IA y úsalas en tus productos.">
        <div className="max-w-6xl space-y-5">
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-violet-500/40 bg-zinc-950 p-5">
            <div>
              <h2 className="text-lg font-black">✨ Estudio de fotos con IA</h2>
              <p className="mt-1 text-sm text-zinc-400">
                Al subir una foto te preguntamos si la quieres mejorar: luz, color, nitidez y fondo de restaurante, sin cambiar el platillo.
                {credits ? ` Te quedan ${credits.left} BPOS Credits hoy (cada foto usa ${credits.perUse}).` : ""}
                {status && !status.available && status.reason === "plan" ? " Mejorar con IA viene en el plan Max; subir fotos funciona en todos." : ""}
              </p>
            </div>
            <label className="cursor-pointer rounded-2xl bg-violet-500 px-5 py-3 font-black text-white hover:bg-violet-400">
              📷 Subir foto
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) setSource({ file });
                }}
              />
            </label>
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-black">🖼️ Galería ({photos.length})</h2>
              {photos.length > 6 && <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 Buscar foto" className="rounded-2xl border border-zinc-800 bg-black px-4 py-2 text-white" />}
            </div>
            {photos.length === 0 ? (
              <p className="mt-4 rounded-2xl border border-dashed border-zinc-700 p-6 text-center text-sm text-zinc-400">Todavía no hay fotos. Toca &quot;Subir foto&quot; para agregar la primera.</p>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {shown.map((p) => {
                  const uses = usedBy.get(p.url) || [];
                  return (
                    <div key={p.id} className="overflow-hidden rounded-2xl border border-zinc-800 bg-black">
                      {/* eslint-disable-next-line @next/next/no-img-element -- fotos del negocio en Supabase Storage */}
                      <img src={p.url} alt={p.name} className="aspect-square w-full object-cover" loading="lazy" />
                      <div className="p-3">
                        <p className="truncate font-black text-white">{p.name}</p>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          {p.enhanced ? <span className="font-bold text-violet-300">✨ Mejorada con IA · </span> : null}
                          {new Date(p.createdAt).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                          {uses.length ? ` · en ${uses.length} producto(s)` : ""}
                        </p>
                        <div className="mt-2 flex gap-2">
                          {!p.enhanced && (
                            <button onClick={() => setSource({ photo: p })} className="flex-1 rounded-xl border border-violet-500 px-2 py-1.5 text-xs font-black text-violet-300 hover:bg-violet-500/10">
                              ✨ Mejorar
                            </button>
                          )}
                          <button onClick={() => void remove(p)} className="flex-1 rounded-xl border border-zinc-700 px-2 py-1.5 text-xs font-black text-zinc-400 hover:border-red-500 hover:text-red-300">
                            Quitar
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
        {source && <PhotoStudio source={source} onClose={() => setSource(null)} onDone={() => setSource(null)} />}
      </AppShell>
    </RequireRole>
  );
}
