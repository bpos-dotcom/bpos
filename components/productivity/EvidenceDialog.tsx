"use client";
/**
 * Foto de evidencia de un recordatorio. Casi ninguna caja tiene cámara: se
 * muestra un QR, el empleado lo abre con su celular, toma la foto y aquí
 * aparece sola. Si la computadora tiene cámara, también se puede tomar aquí.
 * Siempre en vivo: nunca una foto vieja de la galería o de la computadora.
 */
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { uploadBusinessImage } from "@/lib/media";
import { evidencePhoto, newEvidenceToken } from "@/lib/productivity-remote";
import { LiveCamera } from "@/components/productivity/LiveCamera";

const POLL_MS = 3000;

export function EvidenceDialog({ title, onDone, onClose }: { title: string; onDone: (photo: string) => void; onClose: () => void }) {
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cam, setCam] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    const finish = (photo: string) => {
      if (done.current) return;
      done.current = true;
      onDone(photo);
    };
    (async () => {
      try {
        const token = await newEvidenceToken(title);
        if (!alive) return;
        setQr(await QRCode.toDataURL(`${window.location.origin}/evidencia/${token}`, { margin: 1, width: 320, errorCorrectionLevel: "M" }));
        const poll = async () => {
          if (!alive || done.current) return;
          const photo = await evidencePhoto(token).catch(() => "");
          if (photo) finish(photo);
          else timer = window.setTimeout(poll, POLL_MS);
        };
        timer = window.setTimeout(poll, POLL_MS);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "No se pudo crear el QR.");
      }
    })();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- un folio por ventana
  }, []);

  async function fromComputer(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const photo = await uploadBusinessImage(file, "evidencias", 1280);
      if (!done.current) {
        done.current = true;
        onDone(photo);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo subir la foto.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl border border-violet-500/60 bg-zinc-950 p-6 text-center text-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-black text-violet-300">📸 Foto de evidencia</p>
        <h2 className="mt-1 text-2xl font-black">{title}</h2>
        <p className="mt-2 text-sm text-zinc-400">Escanea el QR con tu celular, toma la foto y súbela. Aquí aparece sola.</p>
        <div className="mx-auto mt-4 flex h-64 w-64 items-center justify-center rounded-2xl bg-white p-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- QR generado aquí */}
          {qr ? <img src={qr} alt="QR para subir la foto" className="h-full w-full" /> : <span className="text-sm font-bold text-zinc-500">{error ? "Sin QR" : "Creando QR…"}</span>}
        </div>
        {qr && <p className="mt-3 animate-pulse text-xs font-bold text-violet-300">Esperando la foto…</p>}
        {error && <p className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-300">{error}</p>}
        <button onClick={() => setCam(true)} disabled={busy} className="mt-4 block w-full rounded-2xl border border-zinc-700 px-4 py-3 text-sm font-black text-zinc-200 disabled:opacity-50">
          {busy ? "Subiendo…" : "📷 Tomar con la cámara de este equipo"}
        </button>
        {cam && (
          <LiveCamera
            onClose={() => setCam(false)}
            onShot={(file) => {
              setCam(false);
              void fromComputer(file);
            }}
          />
        )}
        <button onClick={onClose} className="mt-3 w-full rounded-2xl px-4 py-2 text-sm font-bold text-zinc-400">
          Cancelar
        </button>
      </div>
    </div>
  );
}
