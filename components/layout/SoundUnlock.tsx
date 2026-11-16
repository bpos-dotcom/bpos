"use client";
/**
 * El navegador no deja sonar nada en una página que nadie ha tocado desde que
 * se abrió (o se recargó): los avisos de pedidos y recordatorios llegaban
 * mudos. Si es así, se avisa abajo para que toquen la pantalla una vez.
 */
import { useEffect, useState } from "react";

/** ¿Este navegador ya deja sonar audio sin que toquen la pantalla? */
function audioAllowed() {
  try {
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return true;
    const ctx = new Ctx();
    const ok = ctx.state === "running";
    void ctx.close();
    return ok;
  } catch {
    return true;
  }
}

export function SoundUnlock() {
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const unlock = () => setMuted(false);
    const check = window.setTimeout(() => setMuted(!audioAllowed()), 1500);
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.clearTimeout(check);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  if (!muted) return null;
  return (
    <button
      type="button"
      onClick={() => setMuted(false)}
      className="fixed bottom-4 left-1/2 z-[90] -translate-x-1/2 rounded-full border-2 border-yellow-400 bg-yellow-500 px-5 py-3 text-sm font-black text-black shadow-lg"
    >
      🔇 Toca aquí para que suenen los avisos de B-POS
    </button>
  );
}
