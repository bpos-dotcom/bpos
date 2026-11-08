"use client";
/**
 * Una pantalla de B-POS que se quedó abierta sigue usando la versión con la
 * que se abrió. Cada minuto se pregunta qué versión está publicada; si es
 * otra, se recarga sola cuando nadie la está viendo o cuando lleva un rato sin
 * que la toquen en una pantalla segura (el pedido en curso del POS se guarda);
 * si alguien la está usando, muestra un aviso para actualizar. Importa sobre
 * todo en la caja: ahí corre el procesador del Bridge y una versión vieja
 * dejaba los pedidos sin procesar.
 */
import { useEffect, useState } from "react";

const CHECK_MS = 60 * 1000;
/** Sin tocar (teclado, mouse, pantalla) este tiempo: se puede recargar aunque se vea */
const IDLE_MS = 2 * 60 * 1000;
/** Pantallas donde recargar no pierde nada (el POS guarda el pedido en curso) */
const SAFE_PATHS = ["/pos", "/inicio", "/caja", "/cocina", "/bridge", "/pedidos-en-linea", "/dashboard", "/dueno", "/impresiones", "/centro-operaciones"];
/** Con la que se abrió esta pantalla (Vercel la pone al publicar) */
const LOADED = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "";

export function UpdateNotice() {
  const [outdated, setOutdated] = useState(false);

  useEffect(() => {
    if (!LOADED) return;
    let lastInput = Date.now();
    const touched = () => {
      lastInput = Date.now();
    };
    const inputs = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    inputs.forEach((e) => window.addEventListener(e, touched, { passive: true }));
    const check = async () => {
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        const b = (await r.json()) as { build?: string };
        if (!b.build || b.build === LOADED) return;
        const path = window.location.pathname;
        const idle = Date.now() - lastInput > IDLE_MS && SAFE_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
        if (document.hidden || idle) window.location.reload();
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
      inputs.forEach((e) => window.removeEventListener(e, touched));
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
