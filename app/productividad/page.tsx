"use client";
/**
 * Productividad para el personal: mensajes del turno, inventario ciego,
 * pendientes (recordatorios y listas que puso el dueño en su app) y lo que
 * ya se atendió hoy. La alarma que los hace sonar vive en el menú lateral.
 */
import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { notify } from "@/components/layout/Dialogs";
import { EvidenceDialog } from "@/components/productivity/EvidenceDialog";
import { openBlindWindow, useProductivityState } from "@/components/productivity/ProductivityAlarm";
import {
  PRODUCTIVITY_EVENT,
  ackMessage,
  completeTask,
  doneToday,
  recentMessages,
  toggleListItem,
  type PendingTask,
  type ShiftMessage,
  type TaskRecord,
} from "@/lib/productivity";

const hour = (iso: string) => new Date(iso).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });

export default function ProductividadPage() {
  const state = useProductivityState();
  const [messages, setMessages] = useState<ShiftMessage[]>([]);
  const [done, setDone] = useState<TaskRecord[]>([]);
  const [evidenceFor, setEvidenceFor] = useState<PendingTask | null>(null);
  const [photo, setPhoto] = useState("");

  useEffect(() => {
    const sync = () => {
      setMessages(recentMessages());
      setDone(doneToday());
    };
    sync();
    window.addEventListener(PRODUCTIVITY_EVENT, sync);
    const timer = window.setInterval(sync, 30_000);
    return () => {
      window.removeEventListener(PRODUCTIVITY_EVENT, sync);
      window.clearInterval(timer);
    };
  }, []);

  function finish(p: PendingTask, photoUrl?: string) {
    try {
      completeTask(p, photoUrl);
      notify(`✅ "${p.task.title}" quedó atendido.`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "No se pudo.", "error");
    }
  }

  function startBlind() {
    try {
      openBlindWindow();
    } catch (e) {
      notify(e instanceof Error ? e.message : "No se pudo.", "error");
    }
  }

  return (
    <AppShell title="Productividad" subtitle="Mensajes del turno, pendientes y lo que ya se atendió.">
      <div className="mx-auto max-w-4xl space-y-6">
        <section>
          <h2 className="text-xl font-black text-sky-400">💬 Mensajes del turno</h2>
          <div className="mt-3 space-y-3">
            {messages.length === 0 && <p className="rounded-2xl border border-dashed border-zinc-800 p-5 text-center text-sm text-zinc-500">Sin mensajes en las últimas 24 horas.</p>}
            {messages.map((m) => (
              <div key={m.id} className={`rounded-2xl border p-4 ${m.acks.length ? "border-zinc-800 bg-zinc-950" : "animate-pulse border-sky-500 bg-sky-500/10"}`}>
                <p className="text-xs font-bold text-zinc-400">
                  De {m.from} · {hour(m.createdAt)}
                </p>
                <p className="mt-1 text-lg font-black">{m.text}</p>
                {m.acks.length ? (
                  <p className="mt-2 text-xs text-emerald-400">✓ Enterado: {m.acks.map((a) => `${a.name} (${hour(a.at)})`).join(", ")}</p>
                ) : (
                  <button onClick={() => ackMessage(m.id)} className="mt-3 rounded-xl bg-sky-500 px-5 py-2 font-black text-black">
                    Enterado
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        {state.blind && (
          <section className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border-2 border-orange-500 bg-orange-500/15 p-6 shadow-[0_0_40px_rgba(249,115,22,0.35)]">
            <div>
              <p className="text-3xl font-black text-orange-300">📦 INVENTARIO CIEGO</p>
              <p className="mt-1 text-sm text-zinc-300">
                {state.blind.count?.status === "en curso"
                  ? `Lo empezó ${state.blind.count.startedBy || "alguien"} a las ${hour(state.blind.count.startedAt || state.blind.slot)}. Continúa donde se quedó.`
                  : "Cuenta lo que hay de cada insumo y pon la cantidad. Se abre en otra ventana."}
              </p>
            </div>
            <button onClick={startBlind} className="rounded-2xl bg-orange-500 px-8 py-4 text-xl font-black text-black">
              {state.blind.count?.status === "en curso" ? "Continuar" : "Empezar"}
            </button>
          </section>
        )}

        <section>
          <h2 className="text-xl font-black text-violet-400">⏰ Pendientes</h2>
          <div className="mt-3 space-y-3">
            {state.tasks.length === 0 && <p className="rounded-2xl border border-dashed border-zinc-800 p-5 text-center text-sm text-zinc-500">No hay pendientes ahorita. 🙌</p>}
            {state.tasks.map((p) => {
              const checked = new Set(p.record?.checked || []);
              const items = p.task.items || [];
              const allChecked = items.every((i) => checked.has(i));
              return (
                <div key={p.key} className="rounded-2xl border border-violet-500/50 bg-violet-500/10 p-4">
                  <p className="text-xs font-bold text-violet-300">
                    {p.task.kind === "lista" ? "📝 Lista de tareas" : "⏰ Recordatorio"} · tocaba a las {hour(p.slot)}
                    {p.task.evidence ? " · pide foto 📸" : ""}
                  </p>
                  <p className="mt-1 text-xl font-black">{p.task.title}</p>
                  {p.task.kind === "lista" && (
                    <div className="mt-3 space-y-2">
                      {items.map((item) => (
                        <label key={item} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-base font-bold ${checked.has(item) ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200 line-through" : "border-zinc-700 bg-black"}`}>
                          <input type="checkbox" className="h-6 w-6 accent-emerald-500" checked={checked.has(item)} onChange={() => toggleListItem(p, item)} />
                          {item}
                        </label>
                      ))}
                    </div>
                  )}
                  <button
                    disabled={p.task.kind === "lista" && !allChecked}
                    onClick={() => (p.task.evidence ? setEvidenceFor(p) : finish(p))}
                    className="mt-3 w-full rounded-xl bg-violet-500 px-4 py-3 font-black text-black disabled:opacity-40"
                  >
                    {p.task.kind === "lista" ? (allChecked ? (p.task.evidence ? "📸 Terminar (subir foto)" : "✅ Terminar lista") : `Faltan ${items.filter((i) => !checked.has(i)).length} por palomear`) : p.task.evidence ? "📸 Ya lo hice (subir foto)" : "✅ Ya lo hice"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="text-xl font-black text-emerald-400">✓ Atendidos hoy</h2>
          <div className="mt-3 space-y-2">
            {done.length === 0 && <p className="rounded-2xl border border-dashed border-zinc-800 p-5 text-center text-sm text-zinc-500">Todavía no se atiende nada hoy.</p>}
            {done.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-3">
                {r.photo ? (
                  <button onClick={() => setPhoto(r.photo || "")} className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element -- foto de evidencia */}
                    <img src={r.photo} alt="Evidencia" className="h-14 w-14 rounded-xl object-cover" />
                  </button>
                ) : (
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-2xl">✓</span>
                )}
                <div className="min-w-0">
                  <p className="truncate font-black">{r.title}</p>
                  <p className="text-xs text-zinc-400">
                    {r.doneBy} · {r.doneAt ? hour(r.doneAt) : ""} (tocaba a las {hour(r.slot)})
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {evidenceFor && (
        <EvidenceDialog
          title={evidenceFor.task.title}
          onClose={() => setEvidenceFor(null)}
          onDone={(url) => {
            finish(evidenceFor, url);
            setEvidenceFor(null);
          }}
        />
      )}
      {photo && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-4" onClick={() => setPhoto("")}>
          {/* eslint-disable-next-line @next/next/no-img-element -- foto de evidencia */}
          <img src={photo} alt="Evidencia" className="max-h-[90vh] max-w-full rounded-2xl" />
        </div>
      )}
    </AppShell>
  );
}
