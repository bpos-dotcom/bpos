"use client";
/**
 * Una pantalla de B-POS que se quedó abierta sigue usando la versión con la
 * que se abrió. Cada 5 minutos se pregunta qué versión está publicada; si es
 * otra, se recarga sola cuando nadie la está viendo, o muestra un aviso para
 * actualizar (sin interrumpir una venta).
 */
import { useEffect, useState } from "react";

const CHECK_MS = 5 * 60 * 1000;
/** Con la que se abrió esta pantalla (Vercel la pone al publicar) */
const LOADED = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "";

export function UpdateNotice() {
  const [outdated, setOutdated] = useState(false);

  useEffect(() => {
    if (!LOADED) return;
    const check = async () => {
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        const b = (await r.json()) as { build?: string };
        if (!b.build || b.build === LOADED) return;
        if (document.hidden) window.location.reload();
        else setOutdated(true);
      } catch {
        // sin internet: se revisa en la siguiente vuelta
      }
    };
    const timer = window.setInterval(() => void check(), CHECK_MS);
    // Al volver a la pestaña, si ya hay versión nueva se carga
    const onVisible = () => !document.hidden && void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!outdated) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-orange-500 bg-zinc-950 px-4 py-3 text-sm font-bold text-white shadow-2xl">
      <span>✨ Hay una versión nueva de B-POS</span>
      <button onClick={() => window.location.reload()} className="rounded-xl bg-orange-500 px-3 py-1.5 font-black text-black">
        Actualizar
      </button>
    </div>
  );
}
