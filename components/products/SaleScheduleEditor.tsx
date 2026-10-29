"use client";
/** Configuración → Productos: días y horas en que se vende en el POS. */
import { DAY_SHORT, cleanSchedule, scheduleLabel, type SaleSchedule } from "@/lib/sale-schedule";

const EMPTY: SaleSchedule = { days: [], from: "", to: "" };
const timeField = "rounded-xl border border-zinc-800 bg-black px-3 py-2 text-white";

export function SaleScheduleEditor({ value, onChange }: { value?: SaleSchedule; onChange: (next: SaleSchedule | undefined) => void }) {
  const on = Boolean(value);
  const s = value || EMPTY;
  const set = (patch: Partial<SaleSchedule>) => onChange({ ...s, ...patch });
  const label = scheduleLabel(value);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-black p-4">
      <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-300">
        <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked ? { days: [5], from: "", to: "" } : undefined)} className="mt-0.5 h-5 w-5 accent-orange-500" />
        <span>
          🕒 Solo se vende en ciertos días u horas
          <span className="block text-xs text-zinc-500">
            Para promociones: ej. &quot;2 hamburguesas x $140&quot; solo los viernes. Fuera de su horario se ve apagado en el POS y no se puede vender. Los pedidos de delivery no se bloquean.
          </span>
        </span>
      </label>

      {on && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {DAY_SHORT.map((name, day) => {
              const active = s.days.includes(day);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => set({ days: active ? s.days.filter((d) => d !== day) : [...s.days, day] })}
                  className={`w-14 rounded-xl border py-2 text-sm font-black ${active ? "border-orange-500 bg-orange-500/15 text-orange-400" : "border-zinc-800 text-zinc-400"}`}
                >
                  {name}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-300">
            <span>Desde</span>
            <input type="time" value={s.from} onChange={(e) => set({ from: e.target.value })} className={timeField} />
            <span>hasta</span>
            <input type="time" value={s.to} onChange={(e) => set({ to: e.target.value })} className={timeField} />
            <span className="text-xs text-zinc-500">(vacío = todo el día)</span>
          </div>
          <p className="text-sm font-bold text-orange-300">{label ? `Se vende: ${label}` : "Sin días ni horas marcados: se vende siempre."}</p>
        </div>
      )}
    </div>
  );
}

/** Al guardar: sin días ni horas no queda horario. */
export const saveSchedule = cleanSchedule;
