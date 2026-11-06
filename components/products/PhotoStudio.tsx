"use client";
/**
 * Estudio de fotos con IA (plan Max): toma la foto del producto (o una
 * nueva), la manda a /api/ai/fotos y enseña el antes y el después. Solo si el
 * dueño toca "Usar esta foto" se sube como foto del producto; la original
 * no se borra de ningún lado. Cada foto gasta BPOS Credits del día.
 */
import { useEffect, useState } from "react";
import { aiFetch } from "@/lib/ai/client";
import { uploadBusinessImage } from "@/lib/media";

type Credits = { perDay: number; perUse: number; used: number; left: number };
type Status = { available: boolean; reason: "plan" | "inactive" | "unavailable" | "limit" | null; credits: Credits };

const REASON: Record<string, string> = {
  plan: "El Estudio de fotos viene en el plan Max.",
  inactive: "Tu plan no está activo. Revísalo en Configuración → Mi plan.",
  unavailable: "El Estudio de fotos no está disponible por ahora. Intenta más tarde.",
  limit: "Ya usaste las funciones con IA de este mes. Vuelven el próximo mes.",
};

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

export function PhotoStudio({ image, productName, onUse, onClose }: { image?: string; productName: string; onUse: (url: string) => void; onClose: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [original, setOriginal] = useState<string | undefined>(image);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ mediaType: string; data: string } | null>(null);
  const [busy, setBusy] = useState<"" | "mejorando" | "guardando">("");

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

  // Vista previa de una foto nueva elegida aquí (se suelta al cambiarla)
  function pickFile(f: File) {
    if (file && original?.startsWith("blob:")) URL.revokeObjectURL(original);
    setFile(f);
    setOriginal(URL.createObjectURL(f));
    setResult(null);
  }

  async function improve() {
    if (!original) return;
    setBusy("mejorando");
    setError("");
    setResult(null);
    try {
      const source = file || (await (await fetch(original)).blob());
      const data = await toJpegBase64(source);
      const r = await aiFetch("/api/ai/fotos", { method: "POST", body: JSON.stringify({ image: data, mediaType: "image/jpeg" }) });
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

  async function use() {
    if (!result) return;
    setBusy("guardando");
    setError("");
    try {
      const blob = await (await fetch(`data:${result.mediaType};base64,${result.data}`)).blob();
      const url = await uploadBusinessImage(new File([blob], "foto-ia.png", { type: blob.type || "image/png" }), "productos", 1200);
      onUse(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la foto.");
      setBusy("");
    }
  }

  const credits = status?.credits;
  const enough = Boolean(credits && credits.left >= credits.perUse);
  const blocked = status && !status.available ? REASON[status.reason || "unavailable"] : "";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-3 sm:items-center" onClick={() => !busy && onClose()}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-violet-500/40 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Estudio de fotos con IA">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xl font-black text-white">✨ Estudio de fotos con IA</p>
            <p className="text-sm text-zinc-400">{productName || "Producto"} · mejora la foto a calidad de restaurante sin cambiar el platillo.</p>
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

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <figure className="rounded-2xl border border-zinc-800 bg-black p-2">
            <figcaption className="mb-2 text-xs font-black uppercase text-zinc-500">Antes</figcaption>
            {original ? (
              // eslint-disable-next-line @next/next/no-img-element -- foto del negocio o elegida en este momento
              <img src={original} alt="Foto original" className="aspect-square w-full rounded-xl object-contain" />
            ) : (
              <div className="flex aspect-square items-center justify-center rounded-xl text-sm text-zinc-500">Sin foto todavía</div>
            )}
            <label className="mt-2 block cursor-pointer rounded-xl border border-zinc-700 px-3 py-2 text-center text-sm font-black text-zinc-300 hover:border-violet-400">
              {original ? "Usar otra foto" : "Elegir foto"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={Boolean(busy)}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) pickFile(f);
                }}
              />
            </label>
          </figure>
          <figure className="rounded-2xl border border-zinc-800 bg-black p-2">
            <figcaption className="mb-2 text-xs font-black uppercase text-violet-300">Después</figcaption>
            {result ? (
              // eslint-disable-next-line @next/next/no-img-element -- imagen recién hecha por la IA (base64)
              <img src={`data:${result.mediaType};base64,${result.data}`} alt="Foto mejorada" className="aspect-square w-full rounded-xl object-contain" />
            ) : (
              <div className="flex aspect-square items-center justify-center rounded-xl text-center text-sm text-zinc-500">
                {busy === "mejorando" ? "Mejorando la foto… puede tardar unos 20 segundos" : "Aquí aparece la foto mejorada"}
              </div>
            )}
          </figure>
        </div>

        <p className="mt-3 text-xs text-zinc-500">
          La IA solo mejora la luz, el color, la nitidez y el fondo; tiene la orden de no cambiar ingredientes, porciones ni acomodo. Revisa el después antes de usarla: tu foto original no se borra.
        </p>
        {error && <p className="mt-2 text-sm font-bold text-red-300">{error}</p>}

        <div className="mt-4 flex flex-wrap gap-2">
          {!result ? (
            <button
              onClick={() => void improve()}
              disabled={!original || Boolean(busy) || Boolean(blocked) || !enough}
              className="rounded-2xl bg-violet-500 px-5 py-3 font-black text-white disabled:opacity-40"
            >
              {busy === "mejorando" ? "Mejorando…" : `✨ Mejorar foto (${credits?.perUse ?? 5} créditos)`}
            </button>
          ) : (
            <>
              <button onClick={() => void use()} disabled={Boolean(busy)} className="rounded-2xl bg-orange-500 px-5 py-3 font-black text-black disabled:opacity-40">
                {busy === "guardando" ? "Guardando…" : "Usar esta foto"}
              </button>
              <button onClick={() => setResult(null)} disabled={Boolean(busy)} className="rounded-2xl border border-zinc-700 px-5 py-3 font-black text-zinc-300 disabled:opacity-40">
                Descartar
              </button>
            </>
          )}
        </div>
        {credits && !enough && !blocked && <p className="mt-2 text-sm font-bold text-yellow-300">Ya no te alcanzan los BPOS Credits de hoy. Se reinician a medianoche.</p>}
      </div>
    </div>
  );
}
