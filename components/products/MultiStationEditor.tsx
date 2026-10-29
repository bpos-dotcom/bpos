"use client";
/**
 * Multidestino: un producto que se prepara en más de una estación (Boneless
 * Burger se arma en Parrilla y el boneless se fríe en Freidora). Cada
 * estación extra recibe su indicación ("Boneless para Boneless Burger") y
 * las opciones que se marquen para ella (las salsas).
 *
 * Se sugiere solo con la receta: insumos que otra estación prepara
 * (Configuración → Ingredientes → Estación que lo prepara).
 */
import type { ExtraStation, KitchenStation } from "@/data/products";
import { stationLabel } from "@/lib/kds-config";

const STATIONS: KitchenStation[] = ["Parrilla", "Freidora", "Barra", "Cocina"];

type Props = {
  mainStation: KitchenStation;
  extraStations: ExtraStation[];
  suggestions: ExtraStation[];
  onChange: (extra: ExtraStation[]) => void;
};

export function MultiStationEditor({ mainStation, extraStations, suggestions, onChange }: Props) {
  const pending = suggestions.filter((s) => s.station !== mainStation && !extraStations.some((e) => e.station === s.station));
  const free = STATIONS.filter((s) => s !== mainStation && !extraStations.some((e) => e.station === s));
  const update = (i: number, patch: Partial<ExtraStation>) => onChange(extraStations.map((e, j) => (j === i ? { ...e, ...patch } : e)));

  return (
    <section className="mt-6 rounded-3xl border border-zinc-800 bg-black p-6">
      <h3 className="text-xl font-black text-orange-500">📍 Multidestino</h3>
      <p className="mt-2 text-sm text-zinc-400">
        Si otra estación prepara una parte de este producto, también le llega su comanda con lo que tiene que hacer. {stationLabel(mainStation)} recibe el producto completo.
      </p>

      {pending.length > 0 && (
        <div className="mt-4 space-y-2">
          {pending.map((s) => (
            <div key={s.station} className="flex flex-wrap items-center gap-3 rounded-2xl border border-sky-500/50 bg-sky-500/10 p-3 text-sm">
              <span className="flex-1 text-sky-100">
                💡 Por la receta, <b>{stationLabel(s.station)}</b> prepara: {s.text}
              </span>
              <button onClick={() => onChange([...extraStations, s])} className="rounded-xl bg-sky-400 px-3 py-2 text-xs font-black text-black">
                Agregar
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 space-y-2">
        {extraStations.map((extra, i) => (
          <div key={`${extra.station}-${i}`} className="flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-950 p-3">
            <select
              value={extra.station}
              onChange={(e) => update(i, { station: e.target.value as KitchenStation })}
              className="rounded-xl border border-zinc-800 bg-black px-3 py-2 text-sm"
            >
              {STATIONS.filter((s) => s !== mainStation && (s === extra.station || !extraStations.some((e) => e.station === s))).map((s) => (
                <option key={s} value={s}>
                  {stationLabel(s)}
                </option>
              ))}
            </select>
            <input
              value={extra.text}
              onChange={(e) => update(i, { text: e.target.value })}
              placeholder="Qué prepara (ej. Boneless para Boneless Burger)"
              aria-label="Qué prepara esta estación"
              className="min-w-48 flex-1 rounded-xl border border-zinc-800 bg-black px-3 py-2 text-sm"
            />
            <button onClick={() => onChange(extraStations.filter((_, j) => j !== i))} className="rounded-xl border border-red-500/40 px-3 py-2 text-xs font-black text-red-400">
              Quitar
            </button>
          </div>
        ))}
      </div>

      {free.length > 0 && (
        <button onClick={() => onChange([...extraStations, { station: free[0], text: "" }])} className="mt-3 rounded-2xl border border-zinc-700 px-4 py-2 text-sm font-black text-zinc-300">
          + Otra estación
        </button>
      )}
      {extraStations.length > 0 && (
        <p className="mt-3 text-xs text-zinc-500">En cada grupo de opciones marca &quot;También en&quot; para que esa estación vea lo elegido (ej. las salsas).</p>
      )}
    </section>
  );
}
