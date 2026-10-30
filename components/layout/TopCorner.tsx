"use client";
/**
 * Esquina superior derecha de todas las pantallas: modo oscuro/claro, hora,
 * aviso de B-POS Agent (descargarlo si la sucursal no tiene, o "desconectado")
 * y el logo de B-POS.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAgents } from "@/lib/agent/client";
import { getTheme, setTheme, THEME_EVENT, type Theme } from "@/lib/theme";

/** Instalador de B-POS Agent más reciente (GitHub Releases) */
export const DOWNLOAD_URL = "/api/descargar";

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
  const { agents, online } = useAgents(60_000);
  const [windows, setWindows] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- dato del navegador: solo después de montar
  useEffect(() => setWindows(/Windows/i.test(navigator.userAgent)), []);

  return (
    <div className="flex shrink-0 items-center gap-3">
      <div className="flex flex-col items-stretch gap-1.5">
        <ThemeToggle />
        <Clock />
      </div>
      {agents?.length === 0 && windows && (
        <a
          href={DOWNLOAD_URL}
          title="Descargar B-POS Agent: impresoras y pedidos de delivery"
          className="hidden rounded-xl border border-orange-500/50 bg-orange-500/10 px-3 py-2 text-center text-xs font-black leading-tight text-orange-300 hover:bg-orange-500/20 sm:block"
        >
          ⬇️ Descargar
          <br />
          B-POS Agent
        </a>
      )}
      {Boolean(agents?.length) && !online && (
        <Link
          href="/configuracion/sistema"
          title="La computadora de las impresoras no está conectada: no se imprime ni llegan pedidos de delivery"
          className="rounded-xl border border-red-500/50 bg-red-500/10 px-3 py-2 text-center text-xs font-black leading-tight text-red-300 hover:bg-red-500/20"
        >
          🔴 Agent
          <br />
          desconectado
        </Link>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- logo fijo, sin optimizar */}
      <img src="/bpos-logo.png" alt="B-POS" className="h-12 w-12 object-contain sm:h-[68px] sm:w-[68px]" />
    </div>
  );
}
