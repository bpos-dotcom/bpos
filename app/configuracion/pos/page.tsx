"use client";
/**
 * Configuración → Punto de venta.
 *  - Pantalla táctil: de esta caja (no se sincroniza).
 *  - Estaciones: nombre y cuáles existen, y a dónde va lo que no tiene
 *    estación (para todo el negocio).
 */
import { useEffect, useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import type { KitchenStation } from "@/data/products";
import { getBusinessSettings, saveBusinessSettings } from "@/lib/business-settings";
import { setTouchKeypad, touchKeypadEnabled } from "@/lib/device-settings";
import { readKdsStationConfig, saveKdsStationConfig, type KdsStationConfig } from "@/lib/kds-config";

export default function PosSettingsPage() {
  const [touch, setTouch] = useState(false);
  const [stations, setStations] = useState<KdsStationConfig[]>([]);
  const [fallback, setFallback] = useState<KitchenStation>("Cocina");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ajustes del navegador: solo después de montar
    setTouch(touchKeypadEnabled());
    setStations(readKdsStationConfig());
    setFallback(getBusinessSettings().fallbackStation);
  }, []);

  function saveStations() {
    const clean = stations.map((s) => ({ ...s, name: s.name.trim() || s.id }));
    if (!clean.some((s) => s.enabled)) {
      alert("Deja al menos una estación activa.");
      return;
    }
    // Lo que no tiene estación va a una estación activa
    const target = clean.find((s) => s.id === fallback)?.enabled ? fallback : clean.find((s) => s.enabled)!.id;
    saveKdsStationConfig(clean);
    saveBusinessSettings({ fallbackStation: target });
    setStations(clean);
    setFallback(target);
    setSaved("✅ Estaciones guardadas.");
  }

  return (
    <RequireRole allow={["Admin"]}>
      <AppShell title="Punto de venta" subtitle="Pantalla táctil de esta caja y estaciones de cocina del negocio.">
        <div className="max-w-2xl space-y-6">
          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
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
                <span className="block text-lg font-black">🖐️ Pantalla táctil (solo esta caja)</span>
                <span className="mt-1 block text-sm text-zinc-400">
                  Al tocar cualquier campo aparece un teclado grande en pantalla: numérico en cantidades (efectivo recibido, descuento, precios...) con botones rápidos de billetes
                  al cobrar, y con letras en textos (nombre del cliente, comentarios, búsquedas). El teclado físico sigue funcionando; &quot;⌨️ Usar teclado&quot; esconde el de pantalla.
                </span>
              </span>
            </label>
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <h2 className="text-lg font-black">👨‍🍳 Estaciones de cocina</h2>
            <p className="mt-1 text-sm text-zinc-400">El nombre sale en las comandas y en la pantalla de cocina. Apaga las que no tengas.</p>
            <div className="mt-4 space-y-2">
              {stations.map((s, i) => (
                <div key={s.id} className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-black p-3">
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={(e) => setStations((prev) => prev.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))}
                    className="h-5 w-5 accent-orange-500"
                    aria-label={`Estación ${s.name} activa`}
                  />
                  <input
                    value={s.name}
                    onChange={(e) => setStations((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    aria-label={`Nombre de la estación ${s.id}`}
                    className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2"
                  />
                </div>
              ))}
            </div>

            <label className="mt-5 block">
              <span className="mb-2 block text-sm font-bold text-zinc-400">Lo que no tiene estación va a</span>
              <select value={fallback} onChange={(e) => setFallback(e.target.value as KitchenStation)} className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3">
                {stations
                  .filter((s) => s.enabled)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
              <span className="mt-2 block text-xs text-zinc-500">Por ejemplo, un producto de Rappi o DiDi que todavía no tiene equivalencia: se imprime ahí para que alguien lo prepare.</span>
            </label>

            <button onClick={saveStations} className="mt-5 rounded-2xl bg-orange-500 px-6 py-3 font-black text-black">
              Guardar estaciones
            </button>
            {saved && <p className="mt-3 text-sm font-bold text-emerald-400">{saved}</p>}
          </section>
        </div>
      </AppShell>
    </RequireRole>
  );
}
