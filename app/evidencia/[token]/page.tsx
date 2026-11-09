"use client";
/**
 * Foto de evidencia desde el celular del empleado: llega aquí con el QR que
 * mostró la caja (Productividad → Ya lo hice), toma la foto y se sube sola.
 * No pide sesión: el folio del QR es la llave y sirve 2 horas.
 */
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toWebp } from "@/lib/media";

export default function EvidencePage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "").replace(/[^a-f0-9]/gi, "");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    void fetch(`/api/productividad?ver=${token}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { success?: boolean; title?: string; photo?: string | null; error?: string }) => {
        if (!data.success) setError(data.error || "Este QR ya venció.");
        else if (data.photo) setSent(true);
        else setTitle(data.title || "Recordatorio");
      })
      .catch(() => setError("Sin conexión. Revisa tu internet e intenta otra vez."));
  }, [token]);

  function pick(next: File | undefined) {
    if (!next) return;
    setFile(next);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(next));
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const blob = await toWebp(file, 1280);
      const response = await fetch(`/api/productividad?token=${token}`, { method: "PUT", headers: { "Content-Type": "image/webp" }, body: blob });
      const data = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "No se pudo subir la foto.");
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo subir la foto.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center bg-black px-5 py-10 text-center text-white">
      {/* eslint-disable-next-line @next/next/no-img-element -- logo fijo */}
      <img src="/bpos-logo.png" alt="B-POS" className="h-14 w-14 object-contain" />
      <p className="mt-3 text-sm font-black text-violet-300">📸 Foto de evidencia</p>
      {sent ? (
        <>
          <h1 className="mt-6 text-3xl font-black text-emerald-400">✅ ¡Listo!</h1>
          <p className="mt-2 text-zinc-300">La foto ya llegó a la caja. Puedes cerrar esta página.</p>
        </>
      ) : error && !title ? (
        <p className="mt-6 rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">{error}</p>
      ) : (
        <>
          <h1 className="mt-2 text-2xl font-black">{title || "Cargando…"}</h1>
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- vista previa local
            <img src={preview} alt="Tu foto" className="mt-6 max-h-[45vh] w-full max-w-sm rounded-2xl object-contain" />
          ) : (
            <p className="mt-4 text-zinc-400">Toma una foto que muestre que ya quedó hecho.</p>
          )}
          <label className="mt-6 block w-full max-w-sm cursor-pointer rounded-2xl border border-violet-500 bg-violet-500/15 px-5 py-4 text-lg font-black text-violet-100">
            {preview ? "📷 Tomar otra" : "📷 Tomar foto"}
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
          {preview && (
            <button onClick={() => void upload()} disabled={busy} className="mt-3 w-full max-w-sm rounded-2xl bg-violet-500 px-5 py-4 text-lg font-black text-black disabled:opacity-50">
              {busy ? "Subiendo…" : "Subir foto"}
            </button>
          )}
          {error && <p className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
        </>
      )}
    </main>
  );
}
