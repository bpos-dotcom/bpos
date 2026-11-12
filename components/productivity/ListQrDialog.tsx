"use client";
/**
 * QR de una lista de tareas: los empleados lo abren en su celular, palomean
 * lo suyo y toman la foto de las tareas que la piden. El QR se queda aquí
 * con el avance hasta que se terminan todas; entonces la lista queda hecha.
 */
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { getLog, listProgress, type PendingTask } from "@/lib/productivity";
import { listToken, syncRemoteList } from "@/lib/productivity-remote";

const POLL_MS = 4000;

export function ListQrDialog({ pending, onClose }: { pending: PendingTask; onClose: () => void }) {
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(() => listProgress(pending));
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    const read = () => {
      const record = getLog().find((r) => r.id === pending.key);
      setProgress(listProgress(pending, record));
      if (record?.status === "hecho") setFinished(true);
      return record?.status === "hecho";
    };
    (async () => {
      try {
        const token = await listToken(pending);
        if (!alive) return;
        setQr(await QRCode.toDataURL(`${window.location.origin}/evidencia/${token}`, { margin: 1, width: 320, errorCorrectionLevel: "M" }));
        const poll = async () => {
          if (!alive) return;
          await syncRemoteList(pending);
          if (!alive || read()) return;
          timer = window.setTimeout(poll, POLL_MS);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- un QR por ventana
  }, []);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl border border-violet-500/60 bg-zinc-950 p-6 text-center text-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-black text-violet-300">📱 Lista en el celular</p>
        <h2 className="mt-1 text-2xl font-black">{pending.task.title}</h2>
        {finished ? (
          <>
            <p className="mt-6 text-3xl font-black text-emerald-400">✅ ¡Lista completa!</p>
            <button onClick={onClose} className="mt-6 w-full rounded-2xl bg-emerald-500 px-4 py-3 font-black text-black">
              Cerrar
            </button>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-zinc-400">Escanéenlo con su celular: cada quien palomea lo suyo y toma la foto de las tareas que la piden. Varios pueden usarlo a la vez.</p>
            <div className="mx-auto mt-4 flex h-64 w-64 items-center justify-center rounded-2xl bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- QR generado aquí */}
              {qr ? <img src={qr} alt="QR de la lista" className="h-full w-full" /> : <span className="text-sm font-bold text-zinc-500">{error ? "Sin QR" : "Creando QR…"}</span>}
            </div>
            <p className="mt-4 text-lg font-black text-violet-200">
              {progress.done} de {progress.total} tareas
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
            {progress.missing.length > 0 && <p className="mt-2 text-xs text-zinc-400">Faltan: {progress.missing.join(", ")}</p>}
            {error && <p className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-300">{error}</p>}
            <button onClick={onClose} className="mt-4 w-full rounded-2xl border border-zinc-700 px-4 py-2 text-sm font-bold text-zinc-300">
              Cerrar (el QR sigue sirviendo)
            </button>
          </>
        )}
      </div>
    </div>
  );
}
