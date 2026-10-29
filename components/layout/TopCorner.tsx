"use client";
/**
 * Esquina superior derecha de todas las pantallas: modo oscuro/claro, hora,
 * descargar B-POS para Windows (solo si se abrió en el navegador sin
 * instalar) y el logo de B-POS.
 */
import { useEffect, useState } from "react";
import { PUSH_SERVER as CLOUD_SERVER } from "@/lib/push/rules";
import { getTheme, setTheme, THEME_EVENT, type Theme } from "@/lib/theme";

/** ¿Esta pantalla corre en la app instalada de Windows? (null = revisando) */
export function useInstalledApp() {
  const [installed, setInstalled] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/version", { cache: "no-store" })
      .then((r) => r.json())
      .then((b) => alive && setInstalled(Boolean(b?.desktop)))
      .catch(() => alive && setInstalled(false));
    return () => {
      alive = false;
    };
  }, []);
  return installed;
}

export const DOWNLOAD_URL = `${CLOUD_SERVER}/api/descargar`;

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  useEffect(() => {
    const sync = () => setThemeState(getTheme());
    sync();
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);
  const light = theme === "light";
  return (
    <button
      onClick={() => setTheme(light ? "dark" : "light")}
      title={light ? "Cambiar a modo oscuro" : "Cambiar a modo claro"}
      className={`rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm font-black hover:border-orange-500 ${className}`}
    >
      {light ? "🌙 Oscuro" : "☀️ Claro"}
    </button>
  );
}

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = setInterval(tick, 10_000);
    return () => clearInterval(timer);
  }, []);
  if (!now) return <div className="h-10" />;
  return (
    <div className="text-center leading-tight">
      <p className="text-xl font-black tabular-nums">{now.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</p>
      <p className="text-[11px] font-bold capitalize text-zinc-400">{now.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" })}</p>
    </div>
  );
}

export function TopCorner() {
  const installed = useInstalledApp();
  const [windows, setWindows] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- dato del navegador: solo después de montar
  useEffect(() => setWindows(/Windows/i.test(navigator.userAgent)), []);

  return (
    <div className="flex shrink-0 items-center gap-3">
      <div className="flex flex-col items-stretch gap-1.5">
        <ThemeToggle />
        <Clock />
      </div>
      {installed === false && windows && (
        <a
          href={DOWNLOAD_URL}
          title="Descargar B-POS para Windows"
          className="hidden rounded-xl border border-orange-500/50 bg-orange-500/10 px-3 py-2 text-center text-xs font-black leading-tight text-orange-300 hover:bg-orange-500/20 sm:block"
        >
          ⬇️ Descargar
          <br />
          para Windows
        </a>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- logo fijo, sin optimizar */}
      <img src="/bpos-logo.png" alt="B-POS" className="h-12 w-12 object-contain sm:h-[68px] sm:w-[68px]" />
    </div>
  );
}
