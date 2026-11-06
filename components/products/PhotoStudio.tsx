"use client";
/**
 * Estudio de fotos con IA (Tu negocio → Estudio IA). Al subir una foto
 * pregunta "¿Mejorar con IA?": si sí, la manda a /api/ai/fotos (plan Max,
 * gasta BPOS Credits del día) y enseña el antes y el después; se guarda en la
 * galería la que el dueño elija. También mejora una foto que ya está en la
 * galería (la mejorada se agrega como foto nueva; la original se queda).
 */
import { useEffect, useState } from "react";
import { aiFetch } from "@/lib/ai/client";
import { addToGallery, photoName, type GalleryPhoto } from "@/lib/photo-gallery";

type Credits = { perDay: number; perUse: number; used: number; left: number };
type Status = { available: boolean; reason: "plan" | "inactive" | "unavailable" | "limit" | null; credits: Credits };
type Source = { file: File } | { photo: GalleryPhoto };

const REASON: Record<string, string> = {
  plan: "Mejorar con IA viene en el plan Max. La foto se puede subir tal cual.",
  inactive: "Tu plan no está activo. Revísalo en Configuración → Mi plan.",
  unavailable: "Mejorar con IA no está disponible por ahora. La foto se puede subir tal cual.",
  limit: "Ya usaste las funciones con IA de este mes. Vuelven el próximo mes.",
};

/** BPOS Credits y si se puede usar la IA (null mientras carga) */
export function usePhotoCredits() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    aiFetch("/api/ai/fotos", { cache: "no-store" })
      .then((r) => r.json())
      .then((b) => {
        if (!alive) return;
        if (b.success) setStatus(b as Status);
        else setError(b.error || "No se pudo revisar el Estudio de fotos.");
      })
      .catch(() => alive && setError("Sin conexión con B-POS en la nube."));
    return () => {
      alive = false;
    };
  }, []);
  return { status, setStatus, error };
}

/** Foto lista para mandar: JPG de máximo 1600 px por lado (la IA no necesita más) */
async function toJpegBase64(source: Blob): Promise<string> {
  const bitmap = await createImageBitmap(source);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("El navegador no pudo procesar la imagen.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
}

export function PhotoStudio({ source, onDone, onClose }: { source: Source; onDone: (photo: GalleryPhoto) => void; onClose: () => void }) {
  const { status, setStatus, error: statusError } = usePhotoCredits();
  const fromFile = "file" in source;
  const [preview, setPreview] = useState(() => ("file" in source ? "" : source.photo.url));
  const [name, setName] = useState(() => ("file" in source ? photoName(source.file.name) : source.photo.name));
  const [result, setResult] = useState<{ mediaType: string; data: string } | null>(null);
  const [busy, setBusy] = useState<"" | "mejorando" | "guardando">("");
  const [error, setError] = useState("");

  // Vista previa de la foto elegida: se crea y se suelta junto con la ventana
  useEffect(() => {
    if (!("file" in source)) return;
    const url = URL.createObjectURL(source.file);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- la liga temporal solo existe en el navegador
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [source]);

  async function improve() {
    setBusy("mejorando");
    setError("");
    try {
      const blob = "file" in source ? source.file : await (await fetch(source.photo.url)).blob();
      const r = await aiFetch("/api/ai/fotos", { method: "POST", body: JSON.stringify({ image: await toJpegBase64(blob), mediaType: "image/jpeg" }) });
      const b = await r.json().catch(() => ({}));
      if (b.credits) setStatus((s) => (s ? { ...s, credits: b.credits } : s));
      if (!r.ok || !b.success) throw new Error(b.error || "No se pudo mejorar la foto.");
      setResult(b.image);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo mejorar la foto.");
    } finally {
      setBusy("");
    }
  }

  async function keep(which: "mejorada" | "original") {
    if (which === "original" && !fromFile) return onClose();
    setBusy("guardando");
    setError("");
    try {
      const blob = which === "mejorada" && result ? await (await fetch(`data:${result.mediaType};base64,${result.data}`)).blob() : (source as { file: File }).file;
      onDone(await addToGallery(blob, name, which === "mejorada"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la foto.");
      setBusy("");
    }
  }

  const credits = status?.credits;
  const enough = Boolean(credits && credits.left >= credits.perUse);
  const blocked = status && !status.available ? REASON[status.reason || "unavailable"] : "";
  const canImprove = Boolean(status?.available && enough);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-3 sm:items-center" onClick={() => !busy && onClose()}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-violet-500/40 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Estudio de fotos con IA">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xl font-black text-white">{result ? "✨ ¿Cuál guardas?" : fromFile ? "✨ ¿Mejorar con IA?" : "✨ Mejorar con IA"}</p>
            <p className="text-sm text-zinc-400">
              {result ? "Compara el antes y el después." : "La IA mejora la luz, el color, la nitidez y el fondo a calidad de restaurante, sin cambiar el platillo."}
            </p>
          </div>
          <button onClick={onClose} disabled={Boolean(busy)} className="rounded-xl border border-zinc-800 px-3 py-1 font-black disabled:opacity-40" aria-label="Cerrar">
            ✕
          </button>
        </div>

        {credits && (
          <p className="mt-3 rounded-2xl border border-violet-500/30 bg-violet-500/10 px-4 py-2 text-sm font-bold text-violet-200">
            Te quedan {credits.left} BPOS Credits hoy · cada foto usa {credits.perUse} · se reinician a medianoche
          </p>
        )}
        {blocked && <p className="mt-3 rounded-2xl border border-yellow-500/40 bg-yellow-500/10 px-4 py-2 text-sm font-bold text-yellow-200">{blocked}</p>}
        {statusError && !status && <p className="mt-3 text-sm font-bold text-yellow-300">{statusError}</p>}

        <div className={`mt-4 grid gap-3 ${result || busy === "mejorando" ? "sm:grid-cols-2" : ""}`}>
          <figure className="rounded-2xl border border-zinc-800 bg-black p-2">
            <figcaption className="mb-2 text-xs font-black uppercase text-zinc-500">{result || busy === "mejorando" ? "Antes" : "Tu foto"}</figcaption>
            {/* eslint-disable-next-line @next/next/no-img-element -- foto del negocio o elegida en este momento */}
            <img src={preview || undefined} alt="Foto original" className={`w-full rounded-xl object-contain ${result || busy === "mejorando" ? "aspect-square" : "max-h-[50vh]"}`} />
          </figure>
          {(result || busy === "mejorando") && (
            <figure className="rounded-2xl border border-zinc-800 bg-black p-2">
              <figcaption className="mb-2 text-xs font-black uppercase text-violet-300">Después</figcaption>
              {result ? (
                // eslint-disable-next-line @next/next/no-img-element -- imagen recién hecha por la IA (base64)
                <img src={`data:${result.mediaType};base64,${result.data}`} alt="Foto mejorada" className="aspect-square w-full rounded-xl object-contain" />
              ) : (
                <div className="flex aspect-square items-center justify-center rounded-xl text-center text-sm text-zinc-400">Mejorando la foto… puede tardar unos 30 segundos</div>
              )}
            </figure>
          )}
        </div>

        <label className="mt-3 block text-sm font-bold text-zinc-300">
          Nombre en la galería
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="mt-1 w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white" placeholder="Ej. Hamburguesa clásica" />
        </label>
        {error && <p className="mt-2 text-sm font-bold text-red-300">{error}</p>}

        <div className="mt-4 flex flex-wrap gap-2">
          {result ? (
            <>
              <button onClick={() => void keep("mejorada")} disabled={Boolean(busy)} className="rounded-2xl bg-violet-500 px-5 py-3 font-black text-white disabled:opacity-40">
                {busy === "guardando" ? "Guardando…" : "Guardar la mejorada"}
              </button>
              <button onClick={() => void keep("original")} disabled={Boolean(busy)} className="rounded-2xl border border-zinc-700 px-5 py-3 font-black text-zinc-300 disabled:opacity-40">
                {fromFile ? "Guardar la original" : "Quedarme con la original"}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => void improve()} disabled={!canImprove || Boolean(busy)} className="rounded-2xl bg-violet-500 px-5 py-3 font-black text-white disabled:opacity-40">
                {busy === "mejorando" ? "Mejorando…" : `✨ Sí, mejorar con IA (${credits?.perUse ?? 5} créditos)`}
              </button>
              {fromFile && (
                <button onClick={() => void keep("original")} disabled={Boolean(busy)} className="rounded-2xl border border-zinc-700 px-5 py-3 font-black text-zinc-300 disabled:opacity-40">
                  {busy === "guardando" ? "Subiendo…" : "No, subirla así"}
                </button>
              )}
            </>
          )}
        </div>
        {credits && !enough && !blocked && !result && <p className="mt-2 text-sm font-bold text-yellow-300">Ya no te alcanzan los BPOS Credits de hoy. Se reinician a medianoche.</p>}
        <p className="mt-3 text-xs text-zinc-500">La IA tiene la orden de no cambiar ingredientes, porciones ni acomodo. Revisa el después antes de guardarla; la original nunca se borra.</p>
      </div>
    </div>
  );
}
