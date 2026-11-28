"use client";
/**
 * Avisa en pantalla cuando la memoria del navegador pasa del 70 % (antes de
 * que se llene y la caja deje de guardar pedidos, como el 27 nov). Primero
 * intenta liberar espacio solo (quita ventas viejas que ya están en la nube);
 * si sigue alta, muestra el aviso con el reporte para soporte.
 */
import { useEffect, useRef, useState } from "react";
import { emergencyFreeSpace } from "@/lib/cloud/sync";
import { STORAGE_WARN, storageUsage, usageReport } from "@/lib/storage-usage";

const CHECK_MS = 5 * 60 * 1000;
/** Al picar Entendido no vuelve a salir en este rato */
const SNOOZE_MS = 60 * 60 * 1000;

export function MemoryNotice() {
  const [warn, setWarn] = useState<{ pct: number; report: string } | null>(null);
  const snoozeUntil = useRef(0);

  useEffect(() => {
    const check = () => {
      try {
        let u = storageUsage(window.localStorage);
        if (u.ratio < STORAGE_WARN || Date.now() < snoozeUntil.current) {
          setWarn(null);
          return;
        }
        if (emergencyFreeSpace().removed > 0) u = storageUsage(window.localStorage);
        setWarn(u.ratio < STORAGE_WARN ? null : { pct: Math.round(u.ratio * 100), report: usageReport(u) });
      } catch {
        // sin acceso a la memoria: nada que avisar
      }
    };
    const first = window.setTimeout(check, 5_000);
    const timer = window.setInterval(check, CHECK_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

  if (!warn) return null;
  return (
    <div role="alert" className="fixed left-1/2 top-4 z-[80] w-[min(92vw,34rem)] -translate-x-1/2 rounded-2xl border border-amber-500 bg-zinc-950 px-4 py-3 text-sm text-white shadow-2xl">
      <p className="font-black text-amber-300">⚠️ La memoria de B-POS en esta computadora va al {warn.pct} %</p>
      <p className="mt-1 text-zinc-300">Todavía funciona, pero si se llena no se guardarán los pedidos. Toma foto de este aviso y mándasela a soporte.</p>
      <p className="mt-1 break-words text-xs text-zinc-500">{warn.report}</p>
      <button
        onClick={() => {
          snoozeUntil.current = Date.now() + SNOOZE_MS;
          setWarn(null);
        }}
        className="mt-2 rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-black"
      >
        Entendido
      </button>
    </div>
  );
}
