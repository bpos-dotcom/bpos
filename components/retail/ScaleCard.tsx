"use client";
/**
 * Configuración → Sistema → Báscula (solo tienda y ferretería): báscula por
 * cable (botón "Pesar" al vender a granel) y etiquetas con código de barras
 * que imprime la báscula.
 */
import { useEffect, useState } from "react";
import { useBusinessType, isRetailType } from "@/lib/business-type";
import { BAUD_RATES, DEFAULT_SCALE, SCALE_EVENT, getScaleSettings, readSerialWeight, saveScaleSettings, serialSupported, type ScaleSettings } from "@/lib/scale";

const card = "rounded-3xl border border-zinc-800 bg-zinc-950 p-6";
const select = "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white";

export function ScaleCard({ className = "" }: { className?: string }) {
  const type = useBusinessType();
  const [s, setS] = useState<ScaleSettings>(DEFAULT_SCALE);
  const [canSerial, setCanSerial] = useState(false);
  const [test, setTest] = useState("");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const load = () => setS(getScaleSettings());
    load();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- solo se sabe en el navegador
    setCanSerial(serialSupported());
    window.addEventListener(SCALE_EVENT, load);
    return () => window.removeEventListener(SCALE_EVENT, load);
  }, []);

  if (!isRetailType(type)) return null;
  const set = (patch: Partial<ScaleSettings>) => setS(saveScaleSettings(patch));

  async function tryRead() {
    setTesting(true);
    setTest("");
    try {
      const kg = await readSerialWeight(s);
      setTest(`✅ La báscula marca ${kg.toLocaleString("es-MX", { maximumFractionDigits: 3 })} kg`);
    } catch (e) {
      setTest(`⚠️ ${e instanceof Error ? e.message : "No se pudo leer."}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className={`${card} ${className}`} data-scale-card>
      <h2 className="text-lg font-black">⚖️ Báscula</h2>
      <p className="mt-1 text-sm text-zinc-400">Para vender a granel sin escribir el peso. La báscula habla solo con este equipo: no usa internet.</p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-zinc-800 bg-black p-4">
          <label className="flex items-center justify-between gap-3">
            <span className="font-black">🔌 Báscula por cable</span>
            <input type="checkbox" checked={s.serialEnabled} onChange={(e) => set({ serialEnabled: e.target.checked })} className="h-5 w-5 accent-orange-500" />
          </label>
          <p className="mt-1 text-xs text-zinc-500">Al vender a granel sale el botón &quot;⚖️ Pesar&quot;. Funciona en Chrome o Edge en la computadora, con la báscula conectada por USB o serial.</p>
          {!canSerial && <p className="mt-2 text-xs font-bold text-yellow-300">Este navegador no puede leer básculas por cable. Abre B-POS en Chrome o Edge en la computadora.</p>}
          {s.serialEnabled && (
            <div className="mt-3 space-y-3">
              <label className="block text-sm">
                <span className="text-zinc-400">Velocidad (viene en el manual; casi siempre 9600)</span>
                <select value={s.baudRate} onChange={(e) => set({ baudRate: Number(e.target.value) })} className={select}>
                  {BAUD_RATES.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-zinc-400">Comando para pedir el peso (Torrey: P · vacío si la manda sola)</span>
                <input value={s.command} onChange={(e) => set({ command: e.target.value })} maxLength={20} className={select} placeholder="P" />
              </label>
              <button type="button" disabled={testing || !canSerial} onClick={() => void tryRead()} className="w-full rounded-2xl bg-orange-500 py-3 font-black text-black disabled:opacity-40">
                {testing ? "Leyendo..." : "Probar báscula"}
              </button>
              {test && <p className="text-sm font-bold text-zinc-200">{test}</p>}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-black p-4">
          <label className="flex items-center justify-between gap-3">
            <span className="font-black">🏷️ Etiquetas de la báscula</span>
            <input type="checkbox" checked={s.labelsEnabled} onChange={(e) => set({ labelsEnabled: e.target.checked })} className="h-5 w-5 accent-orange-500" />
          </label>
          <p className="mt-1 text-xs text-zinc-500">Si tu báscula imprime una etiqueta con código de barras (empieza con 2), al escanearla el artículo entra con su peso. Pon el número del artículo en la báscula (PLU) como código del artículo en B-POS.</p>
          {s.labelsEnabled && (
            <div className="mt-3 space-y-3">
              <label className="block text-sm">
                <span className="text-zinc-400">La etiqueta trae</span>
                <select value={s.labelValue} onChange={(e) => set({ labelValue: e.target.value === "importe" ? "importe" : "peso" })} className={select}>
                  <option value="peso">El peso</option>
                  <option value="importe">El importe ($)</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-zinc-400">Dígitos del número de artículo (PLU)</span>
                <select value={s.pluDigits} onChange={(e) => set({ pluDigits: Number(e.target.value) as 4 | 5 | 6 })} className={select}>
                  {[4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
