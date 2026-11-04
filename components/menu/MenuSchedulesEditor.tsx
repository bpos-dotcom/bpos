"use client";
/**
 * Configuración → Menú digital: menús con horario (Desayunos, Comida, Cena)
 * y días festivos. Los menús aplican en el POS, la app de meseros, el menú
 * en línea y el kiosco; los días festivos solo a los pedidos en línea.
 */
import { DAY_SHORT, isOnSale, scheduleLabel } from "@/lib/sale-schedule";
import { holidayHoursText, localDate, shortDate, type Holiday, type TimedMenu } from "@/lib/digital-menu";

const input = "rounded-xl border border-zinc-800 bg-black px-3 py-2 text-white";

function DaysPicker({ days, onChange }: { days: number[]; onChange: (days: number[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {DAY_SHORT.map((d, i) => {
        const on = days.length === 0 || days.includes(i);
        return (
          <button
            key={d}
            type="button"
            onClick={() => {
              const all = days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : days;
              const next = on ? all.filter((x) => x !== i) : [...all, i].sort();
              onChange(next.length === 7 ? [] : next);
            }}
            className={`rounded-xl border px-2.5 py-1.5 text-xs font-black ${on ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-700 text-zinc-400"}`}
          >
            {d}
          </button>
        );
      })}
    </div>
  );
}

const PRESETS: { name: string; from: string; to: string }[] = [
  { name: "Desayunos", from: "07:00", to: "12:00" },
  { name: "Comida", from: "12:00", to: "18:00" },
  { name: "Cena", from: "18:00", to: "23:00" },
];

export function TimedMenusEditor({ menus, categories, onChange }: { menus: TimedMenu[]; categories: string[]; onChange: (menus: TimedMenu[]) => void }) {
  const now = new Date();
  const set = (id: string, patch: Partial<TimedMenu>) => onChange(menus.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const add = (preset?: (typeof PRESETS)[number]) =>
    onChange([...menus, { id: `menu-${Math.max(0, ...menus.map((m) => Number(m.id.replace(/[^0-9]/g, "")) || 0)) + 1}`, name: preset?.name || "", categories: [], schedule: { days: [], from: preset?.from || "", to: preset?.to || "" } }]);
  const free = categories.filter((c) => !menus.some((m) => m.categories.includes(c)));

  return (
    <div className="space-y-3">
      {menus.map((m) => {
        const on = isOnSale(m.schedule, now);
        return (
          <div key={m.id} className="rounded-2xl border border-zinc-800 bg-black p-4">
            <div className="flex flex-wrap items-center gap-2">
              <input value={m.name} maxLength={40} placeholder="Nombre (ej. Desayunos)" onChange={(e) => set(m.id, { name: e.target.value })} className={`${input} min-w-0 flex-1 font-black`} />
              <span className={`rounded-full px-3 py-1 text-xs font-black ${on ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-800 text-zinc-400"}`}>{on ? "🟢 Se vende ahora" : "⏸️ Ahora no"}</span>
              <button type="button" onClick={() => onChange(menus.filter((x) => x.id !== m.id))} className="rounded-xl border border-zinc-700 px-3 py-2 text-sm font-bold text-zinc-400 hover:border-red-500 hover:text-red-400">
                Quitar
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <DaysPicker days={m.schedule.days} onChange={(days) => set(m.id, { schedule: { ...m.schedule, days } })} />
              <input type="time" value={m.schedule.from} onChange={(e) => set(m.id, { schedule: { ...m.schedule, from: e.target.value } })} className={input} aria-label="Desde" />
              <span className="text-zinc-500">a</span>
              <input type="time" value={m.schedule.to} onChange={(e) => set(m.id, { schedule: { ...m.schedule, to: e.target.value } })} className={input} aria-label="Hasta" />
            </div>
            <p className="mt-3 text-xs font-bold text-zinc-400">Categorías de este menú</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {categories.map((c) => {
                const mine = m.categories.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => set(m.id, { categories: mine ? m.categories.filter((x) => x !== c) : [...m.categories, c] })}
                    className={`rounded-full border px-3 py-1 text-xs font-black ${mine ? "border-orange-500 bg-orange-500/15 text-orange-300" : "border-zinc-800 text-zinc-500 hover:border-zinc-600"}`}
                  >
                    {mine ? "✓ " : ""}
                    {c}
                  </button>
                );
              })}
            </div>
            {m.categories.length === 0 && <p className="mt-2 text-xs text-yellow-200">Elige al menos una categoría; sin categorías este menú no hace nada.</p>}
            {m.categories.length > 0 && <p className="mt-2 text-xs text-zinc-500">Se venden: {scheduleLabel(m.schedule) || "siempre (pon días u horas)"}.</p>}
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2">
        {PRESETS.filter((p) => !menus.some((m) => m.name.trim().toLowerCase() === p.name.toLowerCase())).map((p) => (
          <button key={p.name} type="button" onClick={() => add(p)} className="rounded-xl border border-dashed border-zinc-700 px-3 py-2 text-sm font-bold text-zinc-300 hover:border-orange-500">
            + {p.name} ({p.from} a {p.to})
          </button>
        ))}
        <button type="button" onClick={() => add()} className="rounded-xl border border-dashed border-zinc-700 px-3 py-2 text-sm font-bold text-zinc-300 hover:border-orange-500">
          + Otro menú
        </button>
      </div>
      {menus.length > 0 && free.length > 0 && <p className="text-xs text-zinc-500">Sin menú (se venden siempre): {free.join(", ")}.</p>}
    </div>
  );
}

/** Próxima fecha (hoy o después) de un día fijo del año: mes 1-12 */
function nextDate(month: number, day: number, now = new Date()) {
  const today = localDate(now);
  const year = now.getFullYear();
  const iso = (y: number) => `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return iso(year) >= today ? iso(year) : iso(year + 1);
}

const QUICK: { name: string; month: number; day: number }[] = [
  { name: "Nochebuena", month: 12, day: 24 },
  { name: "Navidad", month: 12, day: 25 },
  { name: "Fin de año", month: 12, day: 31 },
  { name: "Año nuevo", month: 1, day: 1 },
];

export function HolidaysEditor({ holidays, onChange }: { holidays: Holiday[]; onChange: (holidays: Holiday[]) => void }) {
  const today = localDate(new Date());
  // Los días que ya pasaron se van solos al guardar cualquier cambio
  const save = (next: Holiday[]) => onChange(next.filter((h) => h.date >= today));
  const set = (i: number, patch: Partial<Holiday>) => save(holidays.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  const upcoming = holidays.filter((h) => h.date >= today);

  return (
    <div className="space-y-2">
      {holidays.map((h, i) =>
        h.date < today ? null : (
          <div key={`${h.date}-${i}`} className="flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-800 bg-black p-3">
            <input type="date" value={h.date} min={today} onChange={(e) => e.target.value && set(i, { date: e.target.value })} className={input} aria-label="Fecha" />
            <input value={h.name} maxLength={40} placeholder="Motivo (opcional)" onChange={(e) => set(i, { name: e.target.value })} className={`${input} min-w-0 flex-1`} />
            <select value={h.closed ? "cerrado" : "horario"} onChange={(e) => set(i, { closed: e.target.value === "cerrado" })} className={input} aria-label="Ese día">
              <option value="cerrado">Cerrado</option>
              <option value="horario">Otro horario</option>
            </select>
            {!h.closed && (
              <>
                <input type="time" value={h.from} onChange={(e) => set(i, { from: e.target.value })} className={input} aria-label="Desde" />
                <span className="text-zinc-500">a</span>
                <input type="time" value={h.to} onChange={(e) => set(i, { to: e.target.value })} className={input} aria-label="Hasta" />
              </>
            )}
            <span className="text-xs text-zinc-500">
              {shortDate(h.date)}: {holidayHoursText(h)}
            </span>
            <button type="button" onClick={() => save(holidays.filter((_, j) => j !== i))} className="rounded-xl border border-zinc-700 px-3 py-2 text-sm font-bold text-zinc-400 hover:border-red-500 hover:text-red-400">
              Quitar
            </button>
          </div>
        )
      )}
      {upcoming.length === 0 && <p className="text-sm text-zinc-500">Sin días especiales próximos.</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            const d = new Date();
            d.setDate(d.getDate() + 1);
            save([...holidays, { date: localDate(d), name: "", closed: true, from: "", to: "" }]);
          }}
          className="rounded-xl border border-dashed border-zinc-700 px-3 py-2 text-sm font-bold text-zinc-300 hover:border-orange-500"
        >
          + Agregar día
        </button>
        {QUICK.map((q) => {
          const date = nextDate(q.month, q.day);
          if (holidays.some((h) => h.date === date)) return null;
          return (
            <button
              key={q.name}
              type="button"
              onClick={() => save([...holidays, { date, name: q.name, closed: true, from: "", to: "" }])}
              className="rounded-xl border border-dashed border-zinc-700 px-3 py-2 text-sm font-bold text-zinc-300 hover:border-orange-500"
            >
              + {q.name} ({shortDate(date)})
            </button>
          );
        })}
      </div>
    </div>
  );
}
