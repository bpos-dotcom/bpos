"use client";
/**
 * Configuración → Sistema: apariencia, moneda e idioma, pantalla táctil,
 * respaldos, descargar B-POS para Windows y versión.
 * Tema y pantalla táctil son de ESTE dispositivo (no se sincronizan).
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import { DOWNLOAD_URL, useInstalledApp } from "@/components/layout/TopCorner";
import { setTouchKeypad, touchKeypadEnabled } from "@/lib/device-settings";
import { getTheme, setTheme, THEME_EVENT, type Theme } from "@/lib/theme";

const card = "rounded-3xl border border-zinc-800 bg-zinc-950 p-6";
const select = "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white disabled:opacity-60";

export default function SistemaPage() {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [touch, setTouch] = useState(false);
  const [version, setVersion] = useState("");
  const installed = useInstalledApp();

  useEffect(() => {
    const sync = () => setThemeState(getTheme());
    sync();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ajustes del navegador: solo después de montar
    setTouch(touchKeypadEnabled());
    window.addEventListener(THEME_EVENT, sync);
    fetch("/api/version", { cache: "no-store" })
      .then((r) => r.json())
      .then((b) => setVersion(b?.version || ""))
      .catch(() => undefined);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);

  return (
    <RequireRole allow={["Admin"]}>
      <AppShell title="Sistema" subtitle="Apariencia, región, pantalla táctil, respaldos e instalador de B-POS.">
        <div className="grid max-w-5xl gap-5 lg:grid-cols-2">
          <section className={card}>
            <h2 className="text-lg font-black">🎨 Apariencia (este dispositivo)</h2>
            <p className="mt-1 text-sm text-zinc-400">También puedes cambiarlo con el botón de arriba a la derecha.</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {(
                [
                  ["dark", "🌙 Oscuro"],
                  ["light", "☀️ Claro"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  className={`rounded-2xl border py-4 font-black ${theme === value ? "border-orange-500 bg-orange-500/10 text-orange-400" : "border-zinc-800 bg-black hover:border-zinc-600"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section className={card}>
            <h2 className="text-lg font-black">🌎 Moneda e idioma</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-zinc-400">Moneda</span>
                <select className={select} value="MXN" disabled>
                  <option value="MXN">$ Peso mexicano (MXN)</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-zinc-400">Idioma</span>
                <select className={select} value="es" disabled>
                  <option value="es">Español</option>
                </select>
              </label>
            </div>
            <p className="mt-3 text-xs text-zinc-500">Por ahora B-POS trabaja en pesos mexicanos y en español. Otras monedas e idiomas llegan en una próxima versión.</p>
          </section>

          <section className={card}>
            <label className="flex cursor-pointer items-start gap-4">
              <input
                type="checkbox"
                checked={touch}
                onChange={(event) => {
                  setTouch(event.target.checked);
                  setTouchKeypad(event.target.checked);
                }}
                className="mt-1 h-6 w-6 accent-orange-500"
              />
              <span>
                <span className="block text-lg font-black">🖐️ Pantalla táctil (este dispositivo)</span>
                <span className="mt-1 block text-sm text-zinc-400">
                  Al tocar cualquier campo aparece un teclado grande en pantalla: numérico en cantidades (efectivo recibido, descuento, precios...) con botones rápidos de billetes al cobrar, y con
                  letras en textos (nombre del cliente, comentarios, búsquedas). El teclado físico sigue funcionando; &quot;⌨️ Usar teclado&quot; esconde el de pantalla.
                </span>
              </span>
            </label>
          </section>

          <section className={card}>
            <h2 className="text-lg font-black">💾 Respaldos</h2>
            <p className="mt-1 text-sm text-zinc-400">Copia diaria automática en la caja. Desde aquí descargas una copia o restauras una anterior.</p>
            <Link href="/configuracion/respaldos" className="mt-4 inline-block rounded-2xl bg-orange-500 px-5 py-3 font-black text-black hover:bg-orange-400">
              Abrir respaldos
            </Link>
          </section>

          <section className={`${card} lg:col-span-2`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-black">🪟 B-POS para Windows</h2>
                <p className="mt-1 text-sm text-zinc-400">
                  {installed
                    ? `Esta computadora tiene B-POS instalado${version ? ` (versión ${version})` : ""}. Se actualiza solo al cerrar B-POS.`
                    : "Instálalo en la computadora de la caja para imprimir tickets, trabajar sin internet y recibir pedidos de delivery."}
                </p>
              </div>
              <a href={DOWNLOAD_URL} className="rounded-2xl border border-orange-500 px-5 py-3 font-black text-orange-300 hover:bg-orange-500/10">
                ⬇️ Descargar instalador
              </a>
            </div>
            {installed && version && <p className="mt-4 text-xs text-zinc-500">Versión de B-POS en esta computadora: {version}</p>}
          </section>
        </div>
      </AppShell>
    </RequireRole>
  );
}
