"use client";
/**
 * Foto de evidencia desde el celular del empleado: llega aquí con el QR que
 * mostró la caja (Productividad → Ya lo hice), toma la foto y se sube sola.
 * No pide sesión: el folio del QR es la llave y sirve 2 horas.
 */
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toWebp } from "@/lib/media";
import type { RemoteListItem } from "@/lib/productivity";

const NAME_KEY = "bpos_evidencia_nombre";
const REFRESH_MS = 5000;

/**
 * Lista de tareas en el celular: cada quien palomea lo suyo y toma la foto
 * de las tareas que la piden. Se ve lo que van haciendo los demás y el QR
 * de la caja sigue sirviendo hasta que se terminan todas.
 */
function ListEvidence({ token, title, initial }: { token: string; title: string; initial: RemoteListItem[] }) {
  const [items, setItems] = useState(initial);
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY) || "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [photo, setPhoto] = useState("");

  useEffect(() => {
    const refresh = () =>
      void fetch(`/api/productividad?ver=${token}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((data: { success?: boolean; items?: RemoteListItem[] | null; error?: string }) => {
          if (data.success && Array.isArray(data.items)) setItems(data.items);
          else if (!data.success) setError(data.error || "Este QR ya venció.");
        })
        .catch(() => {});
    const timer = window.setInterval(refresh, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [token]);

  function saveName(value: string) {
    setName(value);
    try {
      localStorage.setItem(NAME_KEY, value);
    } catch {}
  }

  async function send(index: number, init: RequestInit) {
    if (!name.trim()) {
      setError("Escribe tu nombre arriba para saber quién hizo cada tarea.");
      return;
    }
    setBusy(index);
    setError("");
    try {
      const response = await fetch(`/api/productividad?token=${token}&item=${index}`, init);
      const data = (await response.json().catch(() => ({}))) as { success?: boolean; items?: RemoteListItem[]; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "No se pudo guardar.");
      if (data.items) setItems(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(null);
    }
  }

  async function takePhoto(index: number, file: File | undefined) {
    if (!file) return;
    const blob = await toWebp(file, 1280).catch(() => null);
    if (!blob) return setError("No se pudo leer la foto. Intenta otra vez.");
    await send(index, { method: "PUT", headers: { "Content-Type": "image/webp", "x-bpos-nombre": encodeURIComponent(name.trim()) }, body: blob });
  }

  const toggle = (index: number, done: boolean) =>
    send(index, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ done, by: name.trim() }) });

  const done = items.filter((i) => i.done).length;
  const complete = items.length > 0 && done === items.length;

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white">
      <div className="mx-auto max-w-md">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- logo fijo */}
          <img src="/bpos-logo.png" alt="B-POS" className="mx-auto h-12 w-12 object-contain" />
          <p className="mt-2 text-sm font-black text-violet-300">📝 Lista de tareas</p>
          <h1 className="mt-1 text-2xl font-black">{title}</h1>
          <p className={`mt-2 text-lg font-black ${complete ? "text-emerald-400" : "text-violet-200"}`}>{complete ? "✅ ¡Lista completa!" : `${done} de ${items.length} hechas`}</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} />
          </div>
        </div>

        <label className="mt-5 block text-sm">
          <span className="font-bold text-zinc-300">Tu nombre</span>
          <input value={name} onChange={(e) => saveName(e.target.value)} maxLength={40} placeholder="Ej. Damaris" className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white" />
        </label>

        {error && <p className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}

        <div className="mt-4 space-y-3">
          {items.map((item, index) => (
            <div key={index} className={`rounded-2xl border p-3 ${item.done ? "border-emerald-500/50 bg-emerald-500/10" : "border-zinc-700 bg-zinc-950"}`}>
              <div className="flex items-center gap-3">
                {item.url ? (
                  <button onClick={() => setPhoto(item.url || "")} className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element -- foto de evidencia */}
                    <img src={item.url} alt={item.name} className="h-14 w-14 rounded-xl object-cover" />
                  </button>
                ) : (
                  <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-2xl ${item.done ? "bg-emerald-500/20" : "bg-zinc-900"}`}>{item.done ? "✓" : item.photo ? "📷" : "○"}</span>
                )}
                <div className="min-w-0 flex-1">
                  <p className={`font-black ${item.done ? "text-emerald-200" : ""}`}>{item.name}</p>
                  <p className="text-xs text-zinc-400">
                    {item.done ? `${item.by || "Alguien"}${item.at ? ` · ${new Date(item.at).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" })}` : ""}` : item.photo ? "Pide foto" : "Sin foto"}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                {item.photo && (
                  <label className={`flex-1 cursor-pointer rounded-xl px-4 py-3 text-center font-black ${item.done ? "border border-zinc-700 text-zinc-300" : "bg-violet-500 text-black"} ${busy === index ? "opacity-50" : ""}`}>
                    {busy === index ? "Subiendo…" : item.done ? "📷 Tomar otra" : "📷 Tomar foto"}
                    <input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy !== null} onChange={(e) => void takePhoto(index, e.target.files?.[0])} />
                  </label>
                )}
                {!item.photo && !item.done && (
                  <button onClick={() => void toggle(index, true)} disabled={busy !== null} className="flex-1 rounded-xl bg-emerald-500 px-4 py-3 font-black text-black disabled:opacity-50">
                    {busy === index ? "Guardando…" : "✓ Ya quedó"}
                  </button>
                )}
                {item.done && (
                  <button onClick={() => void toggle(index, false)} disabled={busy !== null} className="rounded-xl border border-zinc-700 px-4 py-3 text-sm font-bold text-zinc-400 disabled:opacity-50">
                    Deshacer
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {complete && <p className="mt-5 text-center text-sm text-zinc-400">La caja ya tiene todo. Puedes cerrar esta página.</p>}
      </div>
      {photo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={() => setPhoto("")}>
          {/* eslint-disable-next-line @next/next/no-img-element -- foto de evidencia */}
          <img src={photo} alt="Evidencia" className="max-h-[90vh] max-w-full rounded-2xl" />
        </div>
      )}
    </main>
  );
}

export default function EvidencePage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "").replace(/[^a-f0-9]/gi, "");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const [items, setItems] = useState<RemoteListItem[] | null>(null);

  useEffect(() => {
    void fetch(`/api/productividad?ver=${token}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { success?: boolean; title?: string; photo?: string | null; items?: RemoteListItem[] | null; error?: string }) => {
        if (!data.success) setError(data.error || "Este QR ya venció.");
        else if (Array.isArray(data.items)) {
          setTitle(data.title || "Lista de tareas");
          setItems(data.items);
        } else if (data.photo) setSent(true);
        else setTitle(data.title || "Recordatorio");
      })
      .catch(() => setError("Sin conexión. Revisa tu internet e intenta otra vez."));
  }, [token]);

  if (items) return <ListEvidence token={token} title={title} initial={items} />;

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
