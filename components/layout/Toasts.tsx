"use client";
/**
 * Avisos dentro de B-POS (en vez de alert del navegador): no detienen nada.
 * Un alert bloquea el JavaScript de la página, así que lo que iba en camino
 * (imprimir, abrir el cajón) se quedaba esperando a que dieran Aceptar.
 *   notify("Pedido #12 cobrado.")            → verde, se va solo
 *   notify("No salió el ticket", "error")    → rojo, dura más
 */
import { useEffect, useState } from "react";

type Kind = "ok" | "error";
type Toast = { id: number; message: string; kind: Kind };
const EVENT = "bpos:toast";

export function notify(message: string, kind: Kind = "ok") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { message, kind } }));
}

export function Toasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    let seq = 0;
    const onToast = (e: Event) => {
      const { message, kind } = (e as CustomEvent<{ message: string; kind: Kind }>).detail;
      const id = ++seq;
      setToasts((list) => [...list, { id, message, kind }].slice(-4));
      setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), kind === "error" ? 9000 : 4500);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-[100] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}
          className={`pointer-events-auto max-w-xl rounded-2xl border px-5 py-3 text-sm font-bold shadow-2xl ${t.kind === "error" ? "border-red-500/50 bg-red-950 text-red-100" : "border-green-500/50 bg-green-950 text-green-100"}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
