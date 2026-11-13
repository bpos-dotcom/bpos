"use client";
/**
 * Cámara en vivo dentro de la página para las fotos de evidencia: no hay
 * selector de archivos, así que no se puede escoger una foto vieja de la
 * galería. Si el navegador no deja usar la cámara aquí, se ofrece la cámara
 * del celular y solo se acepta una foto recién tomada.
 */
import { useEffect, useRef, useState } from "react";
import { isFreshPhoto, OLD_PHOTO_ERROR } from "@/lib/fresh-photo";

export function LiveCamera({ onShot, onClose }: { onShot: (file: File) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("sin cámara");
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (!alive) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => {});
        }
        setReady(true);
      } catch {
        if (alive) setFallback(true);
      }
    })();
    return () => {
      alive = false;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function shoot() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")?.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return setError("No se pudo tomar la foto. Intenta otra vez.");
        stream.current?.getTracks().forEach((t) => t.stop());
        onShot(new File([blob], `evidencia-${Date.now()}.jpg`, { type: "image/jpeg", lastModified: Date.now() }));
      },
      "image/jpeg",
      0.9
    );
  }

  function fromPhoneCamera(file: File | undefined) {
    if (!file) return;
    if (!isFreshPhoto(file)) return setError(OLD_PHOTO_ERROR);
    onShot(file);
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black text-white">
      {fallback ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-lg font-black">📷 Toma la foto ahorita</p>
          <p className="text-sm text-zinc-400">Si te pregunta, elige la cámara. Las fotos de la galería no se aceptan.</p>
          <label className="block w-full max-w-sm cursor-pointer rounded-2xl bg-violet-500 px-5 py-4 text-lg font-black text-black">
            Abrir cámara
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { fromPhoneCamera(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        </div>
      ) : (
        <div className="relative flex-1 overflow-hidden">
          <video ref={video} playsInline muted className="h-full w-full object-cover" />
          {!ready && <p className="absolute inset-0 flex items-center justify-center text-sm font-bold text-zinc-400">Abriendo cámara…</p>}
        </div>
      )}
      {error && <p className="mx-4 mb-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-center text-sm text-red-200">{error}</p>}
      <div className="flex items-center justify-between gap-4 p-5 pb-8">
        <button onClick={onClose} className="rounded-2xl px-4 py-3 font-bold text-zinc-300">
          Cancelar
        </button>
        {!fallback && (
          <button onClick={shoot} disabled={!ready} aria-label="Tomar foto" className="h-20 w-20 rounded-full border-4 border-white bg-white/90 disabled:opacity-40" />
        )}
        <span className="w-20" />
      </div>
    </div>
  );
}
