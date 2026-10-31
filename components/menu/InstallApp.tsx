"use client";
/**
 * "Instala la app" del restaurante (su menú digital como app en el celular,
 * con su logo y nombre: ver app/m/[slug]/manifest.webmanifest). En Android
 * Chrome ofrece instalar; en iPhone se explica cómo agregarla a la pantalla
 * de inicio. No sale si ya está instalada o si el cliente la cerró.
 */
import { useEffect, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export function InstallApp({ slug, name, color }: { slug: string; name: string; color: string }) {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [help, setHelp] = useState(false);
  const key = `cliente-app-cerrada:${slug}`;

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(key) === "1";
    } catch {}
    if (standalone || dismissed) return;
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- depende del celular: solo después de montar
    setIos(isIos);
    if (isIos) setHidden(false);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallEvent);
      setHidden(false);
    };
    const onInstalled = () => setHidden(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [key]);

  if (hidden || (!prompt && !ios)) return null;

  function close() {
    try {
      localStorage.setItem(key, "1");
    } catch {}
    setHidden(true);
  }

  async function install() {
    if (!prompt) return setHelp(true);
    await prompt.prompt();
    const choice = await prompt.userChoice.catch(() => ({ outcome: "" }));
    if (choice.outcome === "accepted") setHidden(true);
    setPrompt(null);
  }

  return (
    <div className="mt-6 rounded-3xl border border-orange-100 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="text-3xl">📲</span>
        <div className="min-w-0 flex-1">
          <p className="font-black">Instala la app de {name}</p>
          <p className="text-xs text-zinc-500">Pide más rápido desde tu pantalla de inicio.</p>
        </div>
        <button onClick={() => void install()} className="rounded-xl px-4 py-2 text-sm font-black text-white" style={{ background: color }}>
          Instalar
        </button>
        <button onClick={close} aria-label="Cerrar" className="px-1 text-zinc-400">
          ✕
        </button>
      </div>
      {help && ios && (
        <p className="mt-3 rounded-2xl bg-orange-50 p-3 text-sm">
          En iPhone: toca <b>Compartir</b> (el cuadrito con la flecha ⬆️) abajo en Safari y luego <b>Agregar a pantalla de inicio</b>.
        </p>
      )}
    </div>
  );
}
