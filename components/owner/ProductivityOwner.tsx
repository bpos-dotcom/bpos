"use client";
/**
 * App del dueño → Productividad. Aquí el dueño:
 *  - manda mensajes al turno (suenan en la caja hasta que alguien dé Enterado),
 *  - crea recordatorios y listas de tareas (cuándo suenan, cada cuánto insisten,
 *    si piden foto, si le avisan),
 *  - configura el inventario ciego y revisa sus reportes (ajustar todo a lo
 *    contado o dejarlo como está),
 *  - ve lo que se atendió hoy (con fotos) y lo que sigue pendiente.
 */
import { useEffect, useMemo, useState } from "react";
import { ask, notify } from "@/components/layout/Dialogs";
import { ItemPhotos } from "@/components/productivity/ItemPhotos";
import { getInventory } from "@/lib/inventory";
import { blindEmail } from "@/lib/productivity-remote";
import {
  DAY_NAMES,
  PRODUCTIVITY_EVENT,
  REPEAT_OPTIONS,
  adjustBlindToCounted,
  blindSummary,
  cancelBlind,
  deleteMessage,
  deleteTask,
  dismissBlind,
  doneToday,
  getBlindCounts,
  getProductivitySettings,
  getTasks,
  listProgress,
  pendingTasks,
  productivityHistory,
  recentMessages,
  repeatText,
  requestBlindNow,
  saveProductivitySettings,
  saveTask,
  scheduleText,
  sendShiftMessage,
  type BlindCount,
  type ProductivitySettings,
  type ProductivityTask,
  type Schedule,
  type TaskRecord,
} from "@/lib/productivity";

type View = "hoy" | "recordatorios" | "ciego" | "historial" | "ajustes";
const hour = (iso: string) => new Date(iso).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });
const money = (n: number) => `$${Math.abs(n).toFixed(2)}`;
const inputCls = "w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-white";

function useProductivityData() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener(PRODUCTIVITY_EVENT, bump);
    window.addEventListener("storage", bump);
    const timer = window.setInterval(bump, 30_000);
    return () => {
      window.removeEventListener(PRODUCTIVITY_EVENT, bump);
      window.removeEventListener("storage", bump);
      window.clearInterval(timer);
    };
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- se vuelve a leer con cada cambio
  return useMemo(() => ({ tasks: getTasks(), pending: pendingTasks(), done: doneToday(), messages: recentMessages(), counts: getBlindCounts(), settings: getProductivitySettings() }), [tick]);
}

function Chips<T extends string>({ items, value, onChange }: { items: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(([id, label]) => (
        <button key={id} onClick={() => onChange(id)} className={`rounded-xl border px-3 py-2 text-sm font-black ${value === id ? "border-violet-500 bg-violet-500 text-black" : "border-zinc-800 bg-zinc-950 text-zinc-300"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function DaysPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {DAY_NAMES.map((name, day) => (
        <button
          key={name}
          type="button"
          onClick={() => onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day].sort())}
          className={`rounded-lg border px-2.5 py-1.5 text-xs font-black ${value.includes(day) ? "border-violet-500 bg-violet-500/20 text-violet-200" : "border-zinc-800 text-zinc-500"}`}
        >
          {name}
        </button>
      ))}
      <button type="button" onClick={() => onChange(value.length === 7 ? [] : [0, 1, 2, 3, 4, 5, 6])} className="rounded-lg px-2 py-1.5 text-xs font-bold text-zinc-400 underline">
        {value.length === 7 ? "Ninguno" : "Todos"}
      </button>
    </div>
  );
}

function RepeatPicker({ value, onChange, label = "Si no lo atienden, que vuelva a sonar" }: { value: number; onChange: (n: number) => void; label?: string }) {
  const custom = !REPEAT_OPTIONS.includes(value);
  return (
    <label className="block text-sm">
      <span className="font-bold text-zinc-300">{label}</span>
      <div className="mt-1 flex gap-2">
        <select value={custom ? "otro" : String(value)} onChange={(e) => onChange(e.target.value === "otro" ? 25 : Number(e.target.value))} className={inputCls}>
          {REPEAT_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n === 0 ? "No, solo una vez" : `Cada ${n} minutos hasta que lo atiendan`}
            </option>
          ))}
          <option value="otro">Otro…</option>
        </select>
        {custom && <input type="number" min={1} max={240} value={value} onChange={(e) => onChange(Math.max(1, Math.min(240, Number(e.target.value) || 1)))} className="w-24 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-white" />}
      </div>
    </label>
  );
}

// ------------------------------------------------------------ formulario de recordatorio

type Draft = Omit<ProductivityTask, "id" | "createdAt" | "createdBy"> & { id?: string };

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const blankDraft = (kind: ProductivityTask["kind"]): Draft => ({
  kind,
  title: "",
  speech: "",
  items: kind === "lista" ? [] : undefined,
  schedule: { mode: "dias", days: [0, 1, 2, 3, 4, 5, 6], times: ["12:00"] },
  repeatMinutes: 15,
  evidence: false,
  voice: true,
  notifyDone: false,
  ownerAfterMinutes: 0,
  active: true,
});

function TaskForm({ initial, onClose }: { initial: Draft; onClose: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [itemsText, setItemsText] = useState((initial.items || []).join("\n"));
  const [newTime, setNewTime] = useState("12:00");
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const setSchedule = (s: Schedule) => set({ schedule: s });
  const s = d.schedule;
  const typedItems = [...new Set(itemsText.split("\n").map((t) => t.trim()).filter(Boolean))];
  // Las que ya no están escritas no cuentan
  const photoItems = (d.photoItems || []).filter((i) => typedItems.includes(i));

  function changeMode(mode: Schedule["mode"]) {
    const days = s.mode === "una" ? [0, 1, 2, 3, 4, 5, 6] : s.days;
    if (mode === "una") setSchedule({ mode, date: today(), time: "12:00" });
    else if (mode === "dias") setSchedule({ mode, days, times: ["12:00"] });
    else setSchedule({ mode, days, every: 60, from: "12:00", to: "22:00" });
  }

  function save() {
    const items = typedItems;
    if (!d.title.trim()) return notify("Escribe el recordatorio.", "error");
    if (d.kind === "lista" && !items.length) return notify("Escribe al menos una tarea de la lista (una por renglón).", "error");
    if (s.mode !== "una" && !s.days.length) return notify("Elige al menos un día.", "error");
    if (s.mode === "dias" && !s.times.length) return notify("Agrega al menos una hora.", "error");
    saveTask({ ...d, title: d.title.trim(), speech: d.speech?.trim() || "", items: d.kind === "lista" ? items : undefined, photoItems: d.kind === "lista" && photoItems.length ? photoItems : undefined });
    notify(d.id ? "Recordatorio actualizado." : "Recordatorio creado. Ya está en la caja.");
    onClose();
  }

  return (
    <div className="space-y-4 rounded-3xl border border-violet-500/50 bg-zinc-950 p-4">
      <p className="text-lg font-black">{d.id ? "Editar" : "Nuevo"} {d.kind === "lista" ? "lista de tareas" : "recordatorio"}</p>
      <label className="block text-sm">
        <span className="font-bold text-zinc-300">{d.kind === "lista" ? "Nombre de la lista" : "¿Qué tienen que hacer?"}</span>
        <input value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder={d.kind === "lista" ? "Ej. Apertura" : "Ej. Limpiar la plancha"} className={`mt-1 ${inputCls}`} />
      </label>
      {d.kind === "lista" && (
        <label className="block text-sm">
          <span className="font-bold text-zinc-300">Tareas (una por renglón)</span>
          <textarea value={itemsText} onChange={(e) => setItemsText(e.target.value)} rows={5} placeholder={"Prender freidoras\nRevisar gas\nLimpiar mesas"} className={`mt-1 ${inputCls}`} />
        </label>
      )}
      {d.kind === "lista" && typedItems.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-zinc-800 bg-black p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-zinc-300">📸 ¿Cuáles piden foto?</p>
            <button type="button" onClick={() => set({ photoItems: photoItems.length === typedItems.length ? [] : typedItems })} className="text-xs font-bold text-violet-300 underline">
              {photoItems.length === typedItems.length ? "Ninguna" : "Todas"}
            </button>
          </div>
          <p className="text-xs text-zinc-500">Cada una se hace con su foto y la lista no se termina hasta que estén todas. En la caja sale un QR para hacerla en el celular.</p>
          {typedItems.map((item) => (
            <label key={item} className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={photoItems.includes(item)} onChange={(e) => set({ photoItems: e.target.checked ? [...photoItems, item] : photoItems.filter((x) => x !== item) })} className="h-5 w-5 accent-violet-500" />
              <span className={photoItems.includes(item) ? "font-bold text-white" : "text-zinc-400"}>
                {item}
                {photoItems.includes(item) ? " 📷" : ""}
              </span>
            </label>
          ))}
        </div>
      )}
      <label className="flex items-center gap-2 text-sm font-bold">
        <input type="checkbox" checked={d.voice} onChange={(e) => set({ voice: e.target.checked })} className="h-5 w-5 accent-violet-500" />
        Que una voz lo lea en la caja
      </label>
      {d.voice && (
        <label className="block text-sm">
          <span className="font-bold text-zinc-300">Lo que dice la voz (vacío = el texto de arriba)</span>
          <input value={d.speech || ""} onChange={(e) => set({ speech: e.target.value })} placeholder="Ej. Muchachos, toca limpiar la plancha" className={`mt-1 ${inputCls}`} />
        </label>
      )}

      <div className="space-y-2">
        <p className="text-sm font-bold text-zinc-300">¿Cuándo suena?</p>
        <Chips items={[["dias", "Ciertos días y horas"], ["cada", "Cada cierto tiempo"], ["una", "Una sola vez"]]} value={s.mode} onChange={changeMode} />
        {s.mode !== "una" && <DaysPicker value={s.days} onChange={(days) => setSchedule({ ...s, days })} />}
        {s.mode === "una" && (
          <div className="flex gap-2">
            <input type="date" value={s.date} onChange={(e) => setSchedule({ ...s, date: e.target.value })} className={inputCls} />
            <input type="time" value={s.time} onChange={(e) => setSchedule({ ...s, time: e.target.value })} className={inputCls} />
          </div>
        )}
        {s.mode === "dias" && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {s.times.map((t) => (
                <span key={t} className="flex items-center gap-1 rounded-lg border border-zinc-700 px-2 py-1 text-sm font-black">
                  {t}
                  <button type="button" onClick={() => setSchedule({ ...s, times: s.times.filter((x) => x !== t) })} className="text-zinc-500">
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} className={inputCls} />
              <button type="button" onClick={() => newTime && !s.times.includes(newTime) && setSchedule({ ...s, times: [...s.times, newTime].sort() })} className="shrink-0 rounded-xl border border-violet-500 px-3 text-sm font-black text-violet-300">
                + Hora
              </button>
            </div>
          </div>
        )}
        {s.mode === "cada" && (
          <div className="grid grid-cols-3 gap-2 text-xs">
            <label>
              Cada (min)
              <input type="number" min={5} value={s.every} onChange={(e) => setSchedule({ ...s, every: Math.max(5, Number(e.target.value) || 60) })} className={`mt-1 ${inputCls}`} />
            </label>
            <label>
              Desde
              <input type="time" value={s.from} onChange={(e) => setSchedule({ ...s, from: e.target.value })} className={`mt-1 ${inputCls}`} />
            </label>
            <label>
              Hasta
              <input type="time" value={s.to} onChange={(e) => setSchedule({ ...s, to: e.target.value })} className={`mt-1 ${inputCls}`} />
            </label>
          </div>
        )}
      </div>

      <RepeatPicker value={d.repeatMinutes} onChange={(repeatMinutes) => set({ repeatMinutes })} />
      <label className="flex items-center gap-2 text-sm font-bold">
        <input type="checkbox" checked={d.evidence} onChange={(e) => set({ evidence: e.target.checked, notifyDone: e.target.checked || d.notifyDone })} className="h-5 w-5 accent-violet-500" />
        {d.kind === "lista" ? "📸 Además, una foto al terminar toda la lista" : "📸 Necesita atención: pedir foto de evidencia"}
      </label>
      <label className="flex items-center gap-2 text-sm font-bold">
        <input type="checkbox" checked={d.notifyDone} onChange={(e) => set({ notifyDone: e.target.checked })} className="h-5 w-5 accent-violet-500" />
        Avisarme cuando lo atiendan
      </label>
      <label className="block text-sm">
        <span className="font-bold text-zinc-300">Avisarme si nadie lo atiende en</span>
        <select value={d.ownerAfterMinutes} onChange={(e) => set({ ownerAfterMinutes: Number(e.target.value) })} className={`mt-1 ${inputCls}`}>
          {[0, 10, 15, 30, 60, 120].map((n) => (
            <option key={n} value={n}>
              {n === 0 ? "No avisarme" : `${n} minutos`}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onClose} className="rounded-2xl border border-zinc-700 px-4 py-3 font-black text-zinc-300">
          Cancelar
        </button>
        <button onClick={save} className="rounded-2xl bg-violet-500 px-4 py-3 font-black text-black">
          Guardar
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ historial

/** Un recordatorio o lista atendido (o empezado), con su foto y las de cada tarea */
function RecordCard({ record: r, onOpen }: { record: TaskRecord; onOpen: (url: string) => void }) {
  const unfinished = r.status !== "hecho";
  return (
    <div className={`flex items-center gap-3 rounded-xl border p-3 text-sm ${unfinished ? "border-orange-500/40 bg-orange-500/5" : "border-zinc-800 bg-zinc-950"}`}>
      {r.photo ? (
        <button onClick={() => onOpen(r.photo || "")} className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element -- foto de evidencia */}
          <img src={r.photo} alt="Evidencia" className="h-14 w-14 rounded-lg object-cover" />
        </button>
      ) : (
        <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-lg text-xl ${unfinished ? "bg-orange-500/15" : "bg-emerald-500/15"}`}>{unfinished ? "…" : "✓"}</span>
      )}
      <div className="min-w-0">
        <p className="truncate font-black">{r.title}</p>
        <p className="text-xs text-zinc-400">
          {unfinished ? `Sin terminar · ${r.checked?.length || 0} tareas hechas` : `${r.doneBy || ""} · ${r.doneAt ? hour(r.doneAt) : ""}`} (tocaba {hour(r.slot)})
        </p>
        <ItemPhotos record={r} onOpen={onOpen} />
      </div>
    </div>
  );
}

const dayTitle = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const diff = Math.round((new Date(new Date().toDateString()).getTime() - date.getTime()) / 86_400_000);
  const label = date.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
  return diff === 0 ? `Hoy · ${label}` : diff === 1 ? `Ayer · ${label}` : label.charAt(0).toUpperCase() + label.slice(1);
};

function HistoryView({ onOpen, tick }: { onOpen: (url: string) => void; tick: unknown }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- se vuelve a leer con cada cambio
  const days = useMemo(() => productivityHistory(), [tick]);
  // Abierto de fábrica: el día más reciente que no sea hoy (ayer, casi siempre)
  const [open, setOpen] = useState<string | null>(() => days.find((d) => dayTitle(d.day).startsWith("Hoy") === false)?.day || days[0]?.day || null);
  if (!days.length) return <p className="py-8 text-center text-sm text-zinc-500">Todavía no hay historial. Aquí salen los días con lo que se atendió y sus fotos.</p>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500">Últimos 60 días. Toca un día para ver lo que se hizo y sus fotos (los mensajes al turno se guardan 7 días).</p>
      {days.map((d) => {
        const photos = d.done.concat(d.unfinished).reduce((n, r) => n + (r.photo ? 1 : 0) + Object.keys(r.photos || {}).length, 0);
        const isOpen = open === d.day;
        return (
          <div key={d.day} className="rounded-2xl border border-zinc-800 bg-black">
            <button onClick={() => setOpen(isOpen ? null : d.day)} className="flex w-full items-center justify-between gap-2 p-3 text-left">
              <span className="font-black">{dayTitle(d.day)}</span>
              <span className="shrink-0 text-xs text-zinc-400">
                ✓ {d.done.length}
                {d.unfinished.length ? ` · ⚠️ ${d.unfinished.length}` : ""}
                {photos ? ` · 📷 ${photos}` : ""} {isOpen ? "▲" : "▼"}
              </span>
            </button>
            {isOpen && (
              <div className="space-y-2 border-t border-zinc-800 p-3">
                {d.done.length === 0 && d.unfinished.length === 0 && <p className="text-sm text-zinc-500">No se atendió ningún recordatorio.</p>}
                {d.done.map((r) => (
                  <RecordCard key={r.id} record={r} onOpen={onOpen} />
                ))}
                {d.unfinished.map((r) => (
                  <RecordCard key={r.id} record={r} onOpen={onOpen} />
                ))}
                {d.messages.length > 0 && <p className="pt-1 text-xs font-black text-sky-300">💬 Mensajes al turno</p>}
                {d.messages.map((m) => (
                  <div key={m.id} className="rounded-xl border border-zinc-800 p-2 text-xs">
                    <p className="font-bold">{m.text}</p>
                    <p className="text-zinc-500">
                      {hour(m.createdAt)} · {m.acks.length ? <span className="text-emerald-400">✓ {m.acks.map((a) => `${a.name} ${hour(a.at)}`).join(", ")}</span> : <span className="text-orange-300">Nadie dio Enterado</span>}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------ inventario ciego

function BlindReport({ count }: { count: BlindCount }) {
  const [open, setOpen] = useState(count.status === "enviado");
  const s = blindSummary(count);
  const order = ["falta", "sobra", "sin contar", "cuadra"];
  const rows = s.rows.slice().sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || a.money - b.money);
  const when = new Date(count.submittedAt || count.slot).toLocaleString("es-MX", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  async function adjust() {
    if (!(await ask(`¿Ajustar ${s.falta + s.sobra} insumo(s) a lo que contó el personal? Cada uno queda en lo contado más lo que se movió desde que lo contaron.`, { ok: "Sí, ajustar todo", cancel: "No" }))) return;
    try {
      const n = adjustBlindToCounted(count.id);
      notify(`Listo: ${n} insumo(s) ajustados a lo contado.`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "No se pudo.", "error");
    }
  }

  return (
    <div className={`rounded-2xl border p-4 ${count.status === "enviado" ? "border-orange-500/60 bg-orange-500/10" : "border-zinc-800 bg-zinc-950"}`}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start justify-between gap-3 text-left">
        <div>
          <p className="font-black">📦 {when}</p>
          <p className="text-xs text-zinc-400">
            Contó {count.submittedBy || count.startedBy} · {s.cuadra} cuadran · {s.falta} faltan · {s.sobra} sobran{s.sinContar ? ` · ${s.sinContar} sin contar` : ""}
          </p>
          <p className="mt-1 text-sm">
            <b className="text-red-400">Faltante {money(s.faltante)}</b> · <b className="text-sky-400">Sobrante {money(s.sobrante)}</b>
          </p>
        </div>
        <span className="shrink-0 rounded-lg border border-zinc-700 px-2 py-1 text-xs font-black text-zinc-300">{count.status === "enviado" ? "Por revisar" : count.status === "ajustado" ? "Ajustado" : "Revisado"}</span>
      </button>
      {open && (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500">
                  <th className="py-1">Insumo</th>
                  <th className="py-1 text-right">Contaron</th>
                  <th className="py-1 text-right">Sistema</th>
                  <th className="py-1 text-right">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.ingredientId} className="border-t border-zinc-800">
                    <td className="py-1.5 font-bold">{r.name}</td>
                    <td className="py-1.5 text-right">{r.counted === null ? "—" : `${r.counted} ${r.unit}`}</td>
                    <td className="py-1.5 text-right text-zinc-400">{r.expected === undefined ? "—" : `${Math.round(r.expected * 1000) / 1000} ${r.unit}`}</td>
                    <td className={`py-1.5 text-right font-black ${r.state === "falta" ? "text-red-400" : r.state === "sobra" ? "text-sky-400" : r.state === "cuadra" ? "text-emerald-400" : "text-zinc-500"}`}>
                      {r.state === "falta" || r.state === "sobra" ? `${r.diff > 0 ? "+" : ""}${r.diff} ${r.unit}${r.money ? ` (${money(r.money)})` : ""}` : r.state === "cuadra" ? "Cuadra" : "Sin contar"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {count.status === "enviado" && (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button onClick={() => void adjust()} disabled={!s.falta && !s.sobra} className="rounded-2xl bg-orange-500 px-4 py-3 font-black text-black disabled:opacity-40">
                Ajustar todo a lo contado
              </button>
              <button onClick={() => dismissBlind(count.id)} className="rounded-2xl border border-zinc-700 px-4 py-3 font-black text-zinc-300">
                Dejar el inventario como está
              </button>
            </div>
          )}
          {count.reviewedBy && <p className="mt-2 text-xs text-zinc-500">{count.status === "ajustado" ? "Ajustó" : "Revisó"} {count.reviewedBy} · {count.reviewedAt ? new Date(count.reviewedAt).toLocaleString("es-MX") : ""}</p>}
        </>
      )}
    </div>
  );
}

function BlindSettingsForm({ settings }: { settings: ProductivitySettings }) {
  const [b, setB] = useState(settings.blind);
  const [search, setSearch] = useState("");
  const inventory = useMemo(() => getInventory().slice().sort((x, y) => (x.category || "zzz").localeCompare(y.category || "zzz") || x.name.localeCompare(y.name)), []);
  const chosen = new Set(b.ingredientIds.map(Number));
  const shown = inventory.filter((i) => !search.trim() || i.name.toLowerCase().includes(search.trim().toLowerCase()));

  function save() {
    if (b.enabled && !b.days.length) return notify("Elige al menos un día.", "error");
    if (b.scope === "elegidos" && !b.ingredientIds.length) return notify("Elige al menos un insumo para contar.", "error");
    saveProductivitySettings({ blind: b });
    notify("Inventario ciego guardado.");
  }

  return (
    <div className="space-y-4 rounded-3xl border border-zinc-800 bg-zinc-950 p-4">
      <label className="flex items-center gap-2 font-black">
        <input type="checkbox" checked={b.enabled} onChange={(e) => setB({ ...b, enabled: e.target.checked })} className="h-5 w-5 accent-orange-500" />
        Inventario ciego automático
      </label>
      <div className={b.enabled ? "space-y-4" : "pointer-events-none space-y-4 opacity-40"}>
        <div className="space-y-2">
          <p className="text-sm font-bold text-zinc-300">¿Qué días?</p>
          <DaysPicker value={b.days} onChange={(days) => setB({ ...b, days })} />
        </div>
        <label className="block text-sm">
          <span className="font-bold text-zinc-300">¿A qué hora?</span>
          <input type="time" value={b.time} onChange={(e) => setB({ ...b, time: e.target.value })} className={`mt-1 ${inputCls}`} />
        </label>
      </div>
      <label className="block text-sm">
        <span className="font-bold text-zinc-300">Lo que dice la voz</span>
        <input value={b.speech} onChange={(e) => setB({ ...b, speech: e.target.value })} className={`mt-1 ${inputCls}`} />
      </label>
      <RepeatPicker value={b.repeatMinutes} onChange={(repeatMinutes) => setB({ ...b, repeatMinutes })} label="Si no lo empiezan, que vuelva a sonar" />
      <div className="space-y-2">
        <p className="text-sm font-bold text-zinc-300">¿Qué se cuenta?</p>
        <Chips items={[["todo", "Todo el inventario"], ["elegidos", "Solo lo que yo elija"]]} value={b.scope} onChange={(scope) => setB({ ...b, scope })} />
        {b.scope === "elegidos" && (
          <div className="rounded-2xl border border-zinc-800 p-3">
            <div className="flex gap-2">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar insumo…" className={inputCls} />
              <button type="button" onClick={() => setB({ ...b, ingredientIds: chosen.size === inventory.length ? [] : inventory.map((i) => Number(i.id)) })} className="shrink-0 rounded-xl border border-zinc-700 px-3 text-xs font-black">
                {chosen.size === inventory.length ? "Ninguno" : "Todos"}
              </button>
            </div>
            <p className="mt-2 text-xs text-zinc-500">{chosen.size} elegido(s)</p>
            <div className="mt-2 max-h-72 space-y-1 overflow-y-auto">
              {shown.map((i) => (
                <label key={i.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-zinc-900">
                  <input
                    type="checkbox"
                    checked={chosen.has(Number(i.id))}
                    onChange={() => setB({ ...b, ingredientIds: chosen.has(Number(i.id)) ? b.ingredientIds.filter((x) => Number(x) !== Number(i.id)) : [...b.ingredientIds, Number(i.id)] })}
                    className="h-4 w-4 accent-orange-500"
                  />
                  <span className="flex-1">{i.name}</span>
                  <span className="text-xs text-zinc-500">{i.category || ""}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
      <button onClick={save} className="w-full rounded-2xl bg-orange-500 px-4 py-3 font-black text-black">
        Guardar inventario ciego
      </button>
    </div>
  );
}

// ------------------------------------------------------------ pantalla

export function ProductivityOwner() {
  const data = useProductivityData();
  const [view, setView] = useState<View>("hoy");
  const [form, setForm] = useState<Draft | null>(null);
  const [text, setText] = useState("");
  const [voice, setVoice] = useState(true);
  // Cada cuánto vuelve a sonar este mensaje hasta que den Enterado (de fábrica, el de Ajustes)
  const [sendRepeat, setSendRepeat] = useState(data.settings.messageRepeatMinutes);
  const [photo, setPhoto] = useState("");
  const [email, setEmail] = useState(data.settings.email);
  const [msgRepeat, setMsgRepeat] = useState(data.settings.messageRepeatMinutes);
  const openBlind = data.counts.find((c) => c.status === "pendiente" || c.status === "en curso");
  const reports = data.counts.filter((c) => c.status === "enviado" || c.status === "ajustado" || c.status === "revisado").sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
  const toReview = reports.filter((c) => c.status === "enviado").length;

  function send() {
    if (!text.trim()) return;
    sendShiftMessage(text, { voice, repeatMinutes: sendRepeat });
    setText("");
    notify("Mensaje mandado al turno.");
  }

  async function remove(task: ProductivityTask) {
    if (await ask(`¿Borrar "${task.title}"?`, { ok: "Borrar", cancel: "No" })) deleteTask(task.id);
  }

  function requestNow() {
    try {
      requestBlindNow();
      notify("Listo: ya está sonando en la caja.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "No se pudo.", "error");
    }
  }

  return (
    <div className="space-y-4">
      <Chips
        items={[
          ["hoy", "Hoy"],
          ["recordatorios", "Recordatorios y listas"],
          ["ciego", `Inventario ciego${toReview ? ` (${toReview})` : ""}`],
          ["historial", "📅 Historial"],
          ["ajustes", "⚙️ Ajustes"],
        ]}
        value={view}
        onChange={setView}
      />

      {view === "hoy" && (
        <>
          <section className="space-y-2 rounded-3xl border border-sky-500/40 bg-sky-500/5 p-4">
            <p className="font-black text-sky-300">💬 Mensaje al turno</p>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Ej. Hoy llega el proveedor de pan a las 5, recíbanlo y cuenten" className={inputCls} />
            <label className="flex items-center gap-2 text-sm font-bold">
              <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} className="h-5 w-5 accent-sky-500" />
              Que la voz lo lea
            </label>
            <RepeatPicker value={sendRepeat} onChange={setSendRepeat} label="Si nadie da Enterado, que el sonido y el mensaje vuelvan a sonar" />
            <button onClick={send} disabled={!text.trim()} className="w-full rounded-2xl bg-sky-500 px-4 py-3 font-black text-black disabled:opacity-40">
              Mandar a la caja
            </button>
            {data.messages.map((m) => (
              <div key={m.id} className="flex items-start justify-between gap-2 rounded-xl border border-zinc-800 bg-black p-3 text-sm">
                <div>
                  <p className="font-bold">{m.text}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {hour(m.createdAt)}{m.repeatMinutes > 0 && !m.acks.length ? ` · suena cada ${m.repeatMinutes} min` : ""} · {m.acks.length ? <span className="text-emerald-400">✓ Enterado: {m.acks.map((a) => `${a.name} ${hour(a.at)}`).join(", ")}</span> : <span className="text-orange-300">Sin leer</span>}
                  </p>
                </div>
                <button onClick={() => deleteMessage(m.id)} className="text-xs text-zinc-500">
                  ✕
                </button>
              </div>
            ))}
          </section>

          <section className="space-y-2">
            <p className="font-black text-violet-300">⏰ Pendientes ahorita ({data.pending.length})</p>
            {data.pending.length === 0 && <p className="text-sm text-zinc-500">Nada pendiente.</p>}
            {data.pending.map((p) => (
              <div key={p.key} className="rounded-xl border border-violet-500/40 bg-violet-500/10 p-3 text-sm">
                <p className="font-black">{p.task.title}</p>
                <p className="text-xs text-zinc-400">Tocaba a las {hour(p.slot)} · {repeatText(p.task.repeatMinutes)}</p>
                {p.task.kind === "lista" &&
                  (() => {
                    const progress = listProgress(p);
                    return (
                      <p className="mt-1 text-xs font-bold text-violet-200">
                        {progress.done} de {progress.total} tareas{progress.missing.length ? ` · faltan: ${progress.missing.join(", ")}` : ""}
                      </p>
                    );
                  })()}
                {p.record && <ItemPhotos record={p.record} onOpen={setPhoto} />}
              </div>
            ))}
            {openBlind && <p className="rounded-xl border border-orange-500/40 bg-orange-500/10 p-3 text-sm font-bold">📦 Inventario ciego {openBlind.status === "en curso" ? `en curso (${openBlind.startedBy})` : "pedido, nadie lo ha empezado"}</p>}
          </section>

          <section className="space-y-2">
            <p className="font-black text-emerald-300">✓ Atendidos hoy ({data.done.length})</p>
            {data.done.length === 0 && <p className="text-sm text-zinc-500">Todavía nada.</p>}
            {data.done.map((r) => (
              <RecordCard key={r.id} record={r} onOpen={setPhoto} />
            ))}
          </section>
        </>
      )}

      {view === "historial" && <HistoryView onOpen={setPhoto} tick={data} />}

      {view === "recordatorios" && (
        <>
          {form ? (
            <TaskForm initial={form} onClose={() => setForm(null)} />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setForm(blankDraft("recordatorio"))} className="rounded-2xl bg-violet-500 px-4 py-3 font-black text-black">
                + Recordatorio
              </button>
              <button onClick={() => setForm(blankDraft("lista"))} className="rounded-2xl border border-violet-500 px-4 py-3 font-black text-violet-200">
                + Lista de tareas
              </button>
            </div>
          )}
          {!form && data.tasks.length === 0 && <p className="py-8 text-center text-sm text-zinc-500">Todavía no hay recordatorios. Crea el primero.</p>}
          {!form &&
            data.tasks.map((t) => (
              <div key={t.id} className={`rounded-2xl border p-4 ${t.active ? "border-zinc-700 bg-zinc-950" : "border-zinc-900 bg-black opacity-60"}`}>
                <p className="text-xs font-bold text-violet-300">
                  {t.kind === "lista" ? `📝 Lista · ${t.items?.length || 0} tareas` : "⏰ Recordatorio"}
                  {t.kind === "lista" && t.photoItems?.length ? ` · 📷 ${t.photoItems.length} con foto` : ""}
                  {t.evidence ? " · 📸 pide foto" : ""}
                  {t.voice ? " · 🔊 voz" : ""}
                </p>
                <p className="mt-1 text-lg font-black">{t.title}</p>
                <p className="text-xs text-zinc-400">{scheduleText(t.schedule)}</p>
                <p className="text-xs text-zinc-400">{repeatText(t.repeatMinutes)}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => setForm({ ...t })} className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-black">
                    Editar
                  </button>
                  <button onClick={() => saveTask({ ...t, active: !t.active })} className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-black">
                    {t.active ? "Pausar" : "Activar"}
                  </button>
                  <button onClick={() => void remove(t)} className="rounded-xl border border-red-500/40 px-3 py-1.5 text-xs font-black text-red-300">
                    Borrar
                  </button>
                </div>
              </div>
            ))}
        </>
      )}

      {view === "ciego" && (
        <>
          <div className="rounded-3xl border border-orange-500/40 bg-orange-500/5 p-4">
            <p className="font-black">📦 Pedirlo ahorita</p>
            <p className="mt-1 text-xs text-zinc-400">Suena en la caja aunque no sea el día ni la hora.</p>
            {openBlind ? (
              <div className="mt-3 flex items-center justify-between gap-2 text-sm">
                <span className="font-bold text-orange-200">{openBlind.status === "en curso" ? `En curso: lo está contando ${openBlind.startedBy}` : "Pedido: nadie lo ha empezado"}</span>
                <button onClick={() => void ask("¿Cancelar este inventario ciego?", { ok: "Cancelar", cancel: "No" }).then((ok) => ok && cancelBlind(openBlind.id))} className="shrink-0 rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-black">
                  Cancelar
                </button>
              </div>
            ) : (
              <button onClick={requestNow} className="mt-3 w-full rounded-2xl bg-orange-500 px-4 py-3 font-black text-black">
                Pedir inventario ciego ahora
              </button>
            )}
          </div>
          <BlindSettingsForm settings={data.settings} />
          <p className="font-black">Reportes</p>
          {reports.length === 0 && <p className="text-sm text-zinc-500">Todavía no hay inventarios ciegos subidos.</p>}
          {reports.map((c) => (
            <BlindReport key={c.id} count={c} />
          ))}
        </>
      )}

      {view === "ajustes" && (
        <div className="space-y-4 rounded-3xl border border-zinc-800 bg-zinc-950 p-4">
          <label className="block text-sm">
            <span className="font-bold text-zinc-300">Correo para los reportes del inventario ciego</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={blindEmail() || "tu@correo.com"} className={`mt-1 ${inputCls}`} />
            <span className="mt-1 block text-xs text-zinc-500">Vacío: se usa el correo del corte de caja o el del negocio{blindEmail() ? ` (${blindEmail()})` : ""}.</span>
          </label>
          <RepeatPicker value={msgRepeat} onChange={setMsgRepeat} label="Mensajes al turno: cada cuánto vuelven a sonar (lo que sale de fábrica al mandar uno)" />
          <button
            onClick={() => {
              const clean = email.trim().toLowerCase();
              if (clean && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return notify("Ese correo no es válido.", "error");
              saveProductivitySettings({ email: clean, messageRepeatMinutes: msgRepeat });
              notify("Ajustes guardados.");
            }}
            className="w-full rounded-2xl bg-violet-500 px-4 py-3 font-black text-black"
          >
            Guardar ajustes
          </button>
          <p className="text-xs text-zinc-500">Los avisos suenan en la computadora marcada como caja principal (Configuración → Sistema), en cualquier pantalla de B-POS. La voz es la del navegador (gratis).</p>
        </div>
      )}

      {photo && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-4" onClick={() => setPhoto("")}>
          {/* eslint-disable-next-line @next/next/no-img-element -- foto de evidencia */}
          <img src={photo} alt="Evidencia" className="max-h-[90vh] max-w-full rounded-2xl" />
        </div>
      )}
    </div>
  );
}
