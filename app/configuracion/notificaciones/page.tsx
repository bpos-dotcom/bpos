"use client";
/**
 * Configuración → Notificaciones (solo Admin): cómo avisa B-POS de cada
 * cosa. Sonido (de B-POS o uno propio), cuántas veces suena, color del
 * recuadro del logo, si parpadea y si se repite hasta que alguien lo atienda.
 * Aplica a todas las cajas del negocio.
 */
import { useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import { uploadBusinessAudio } from "@/lib/media";
import { ALERT_LABELS, BUILTIN_SOUNDS, DEFAULT_ALERTS, playAlert, saveAlertPref, type AlertKind, type AlertPref } from "@/lib/notifications/settings";
import { useAlertSettings } from "@/lib/notifications/useAlert";

const KINDS = Object.keys(ALERT_LABELS) as AlertKind[];

function AlertEditor({ kind, pref }: { kind: AlertKind; pref: AlertPref }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const custom = !BUILTIN_SOUNDS.some((s) => s.src === pref.sound);
  const set = (patch: Partial<AlertPref>) => saveAlertPref(kind, patch);

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      set({ sound: await uploadBusinessAudio(file) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo subir el audio.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black">{ALERT_LABELS[kind].title}</h2>
          <p className="text-sm text-zinc-400">{ALERT_LABELS[kind].hint}</p>
        </div>
        {/* Así se ve el recuadro del logo con este aviso */}
        <div
          className={`rounded-2xl border px-4 py-3 text-sm font-black text-white ${pref.blink ? "animate-pulse" : ""}`}
          style={{ borderColor: pref.color, background: `${pref.color}33`, boxShadow: `0 0 24px ${pref.color}8c` }}
        >
          Así se ve el aviso
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="block text-sm font-bold text-zinc-300">
          Sonido
          <select
            value={custom ? "__custom" : pref.sound}
            onChange={(e) => e.target.value !== "__custom" && set({ sound: e.target.value })}
            className="mt-1 w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
          >
            {BUILTIN_SOUNDS.map((s) => (
              <option key={s.src} value={s.src}>
                {s.name}
              </option>
            ))}
            {custom && <option value="__custom">Mi audio</option>}
          </select>
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <button onClick={() => playAlert(pref)} className="rounded-2xl border border-zinc-700 px-4 py-3 text-sm font-black hover:border-orange-500">
            ▶ Probar
          </button>
          <label className="cursor-pointer rounded-2xl border border-orange-500 px-4 py-3 text-sm font-black text-orange-300 hover:bg-orange-500/10">
            {uploading ? "Subiendo..." : "Subir mi audio"}
            <input type="file" accept="audio/*" className="hidden" disabled={uploading} onChange={(e) => void upload(e.target.files?.[0])} />
          </label>
        </div>

        <label className="block text-sm font-bold text-zinc-300">
          ¿Cuántas veces suena?
          <select value={pref.times} onChange={(e) => set({ times: Number(e.target.value) })} className="mt-1 w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white">
            <option value={0}>Sin sonido</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "vez" : "veces"}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-bold text-zinc-300">
          Color del aviso
          <div className="mt-1 flex items-center gap-3">
            <input type="color" value={pref.color} onChange={(e) => set({ color: e.target.value })} className="h-12 w-16 cursor-pointer rounded-xl border border-zinc-800 bg-black" />
            <span className="font-mono text-zinc-400">{pref.color}</span>
          </div>
        </label>

        <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-zinc-800 bg-black p-4">
          <input type="checkbox" checked={pref.blink} onChange={(e) => set({ blink: e.target.checked })} className="h-5 w-5 accent-orange-500" />
          <span className="font-black">Parpadear hasta que se atienda</span>
        </label>
        <div className="rounded-2xl border border-zinc-800 bg-black p-4">
          <label className="flex cursor-pointer items-center gap-3">
            <input type="checkbox" checked={pref.repeat} onChange={(e) => set({ repeat: e.target.checked })} className="h-5 w-5 accent-orange-500" />
            <span className="font-black">Volver a sonar hasta que se atienda</span>
          </label>
          {pref.repeat && (
            <label className="mt-3 flex items-center gap-2 text-sm text-zinc-300">
              Cada
              <select value={pref.every} onChange={(e) => set({ every: Number(e.target.value) })} className="rounded-xl border border-zinc-800 bg-zinc-950 px-2 py-1">
                {[2, 5, 10, 15, 30, 60, 120, 300].map((s) => (
                  <option key={s} value={s}>
                    {s < 60 ? `${s} segundos` : `${s / 60} min`}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
      {error && <p className="mt-3 text-sm font-bold text-red-300">{error}</p>}
      <button onClick={() => saveAlertPref(kind, DEFAULT_ALERTS[kind])} className="mt-4 text-xs text-zinc-500 underline">
        Regresar a como venía
      </button>
    </section>
  );
}

export default function NotificacionesPage() {
  const settings = useAlertSettings();
  return (
    <RequireRole allow={["Admin"]}>
      <AppShell title="Notificaciones" subtitle="Sonido, color y repetición de cada aviso. Aplica a todas las cajas del negocio.">
        <div className="max-w-4xl space-y-5">
          <p className="rounded-2xl border border-zinc-800 bg-black p-4 text-sm text-zinc-400">
            El navegador solo deja sonar a B-POS después de que alguien toca la pantalla una vez. Deja B-POS abierto en la caja.
          </p>
          {KINDS.map((kind) => (
            <AlertEditor key={kind} kind={kind} pref={settings[kind]} />
          ))}
        </div>
      </AppShell>
    </RequireRole>
  );
}
