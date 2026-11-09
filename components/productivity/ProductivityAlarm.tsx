"use client";
/**
 * Alarma de Productividad. Va en el menú lateral, así que corre en cualquier
 * pantalla de B-POS (aunque la ventana esté minimizada, con el mismo reloj
 * del Bridge). Solo suena en la caja principal: pip pip pip, la voz lee el
 * recordatorio y sale la ventana para atenderlo. Vuelve a sonar cada tantos
 * minutos (lo que puso el dueño) hasta que lo atiendan.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { notify } from "@/components/layout/Dialogs";
import { EvidenceDialog } from "@/components/productivity/EvidenceDialog";
import { addAuditEvent } from "@/lib/audit";
import { startBackgroundTicker } from "@/lib/background-ticker";
import { isPrimaryDevice } from "@/lib/cloud/sync";
import {
  PRODUCTIVITY_EVENT,
  ackMessage,
  completeTask,
  getProductivitySettings,
  pendingBlind,
  pendingTasks,
  startBlind,
  unreadMessages,
  type PendingTask,
  type ShiftMessage,
} from "@/lib/productivity";

const RANG_KEY = "bpos_productivity_rang"; // de este dispositivo: cuándo sonó cada aviso
const OWNER_KEY = "bpos_productivity_owner_told"; // avisos de "sin atender" ya mandados al dueño
const TICK_MS = 15_000;

export type ProductivityState = {
  tasks: PendingTask[];
  messages: ShiftMessage[];
  blind: ReturnType<typeof pendingBlind>;
  count: number;
};

function readState(): ProductivityState {
  const tasks = pendingTasks();
  const messages = unreadMessages();
  const blind = pendingBlind();
  return { tasks, messages, blind, count: tasks.length + messages.length + (blind ? 1 : 0) };
}

const EMPTY: ProductivityState = { tasks: [], messages: [], blind: null, count: 0 };

/** Pendientes de Productividad (para el menú lateral, la alarma y la página) */
export function useProductivityState() {
  const [state, setState] = useState<ProductivityState>(EMPTY);
  useEffect(() => {
    const sync = () => setState(readState());
    sync();
    // Los horarios llegan solos con la hora: se revisa cada 20 s
    const timer = window.setInterval(sync, 20_000);
    window.addEventListener(PRODUCTIVITY_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(PRODUCTIVITY_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return state;
}

/** Abre el inventario ciego en otra ventana (para no ocupar el POS) */
export function openBlindWindow() {
  const count = startBlind();
  const url = `/productividad/inventario-ciego?id=${encodeURIComponent(count.id)}`;
  const win = window.open(url, "bpos-inventario-ciego", "width=980,height=900");
  if (!win) window.location.href = url;
}

// ------------------------------------------------------------ sonido y voz

function beep(times = 3) {
  try {
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return 0;
    const ctx = new Ctx();
    for (let i = 0; i < times; i++) {
      const start = ctx.currentTime + i * 0.28;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 1046;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.2);
    }
    window.setTimeout(() => void ctx.close(), times * 280 + 400);
    return times * 280 + 150;
  } catch {
    return 0;
  }
}

/** Voz del navegador (gratis): Chrome y Edge leen en español sin internet ni proveedor */
export function speak(text: string) {
  try {
    if (!("speechSynthesis" in window) || !text.trim()) return;
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find((v) => v.lang === "es-MX") || voices.find((v) => v.lang.startsWith("es"));
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || "es-MX";
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  } catch {
    // sin voz en este navegador
  }
}

function readMap(key: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}") || {};
  } catch {
    return {};
  }
}

// ------------------------------------------------------------ alarma

type Ring = { key: string; repeat: number; text: string };

function rings(state: ProductivityState): Ring[] {
  const settings = getProductivitySettings();
  return [
    ...state.messages.map((m) => ({ key: `msg|${m.id}`, repeat: m.repeatMinutes, text: m.voice ? `Mensaje del dueño: ${m.text}` : "" })),
    ...state.tasks.map((p) => ({ key: `task|${p.key}`, repeat: p.task.repeatMinutes, text: p.task.voice ? `${p.task.kind === "lista" ? "Lista de tareas" : "Recordatorio"}: ${p.task.speech?.trim() || p.task.title}` : "" })),
    ...(state.blind ? [{ key: `blind|${state.blind.slot}`, repeat: settings.blind.repeatMinutes, text: state.blind.count?.status === "en curso" ? "" : settings.blind.speech }] : []),
  ];
}

export function ProductivityAlarm() {
  const router = useRouter();
  const state = useProductivityState();
  const [open, setOpen] = useState(false);
  const [evidenceFor, setEvidenceFor] = useState<PendingTask | null>(null);

  const tick = useCallback(() => {
    if (!isPrimaryDevice() || window.location.pathname.startsWith("/productividad/inventario-ciego")) return;
    const current = readState();
    if (!current.count) return;
    const now = Date.now();
    const rang = readMap(RANG_KEY);
    const due = rings(current).filter((r) => !rang[r.key] || (r.repeat > 0 && now - rang[r.key] >= r.repeat * 60_000));
    // El dueño pidió que le avisen si nadie lo atiende en N minutos
    const told = readMap(OWNER_KEY);
    for (const p of current.tasks) {
      const after = Number(p.task.ownerAfterMinutes) || 0;
      if (after > 0 && !told[p.key] && now - Date.parse(p.slot) >= after * 60_000) {
        told[p.key] = now;
        addAuditEvent({ category: "Productividad", action: "task.overdue", description: `Nadie ha atendido "${p.task.title}" (tocaba a las ${new Date(p.slot).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" })})`, entityId: p.task.id, metadata: { slot: p.slot } });
      }
    }
    try {
      localStorage.setItem(OWNER_KEY, JSON.stringify(Object.fromEntries(Object.entries(told).filter(([, t]) => now - t < 2 * 86_400_000))));
    } catch {}
    if (!due.length) return;
    due.forEach((r) => (rang[r.key] = now));
    try {
      localStorage.setItem(RANG_KEY, JSON.stringify(Object.fromEntries(Object.entries(rang).filter(([, t]) => now - t < 2 * 86_400_000))));
    } catch {}
    const wait = beep(3);
    const text = due.map((r) => r.text).filter(Boolean).join(". ");
    if (text) window.setTimeout(() => speak(text), wait);
    setOpen(true);
  }, []);

  useEffect(() => {
    const first = window.setTimeout(tick, 3000);
    const stop = startBackgroundTicker(TICK_MS, tick);
    window.addEventListener(PRODUCTIVITY_EVENT, tick);
    return () => {
      window.clearTimeout(first);
      stop();
      window.removeEventListener(PRODUCTIVITY_EVENT, tick);
    };
  }, [tick]);

  const visible = open && state.count > 0;

  function done(p: PendingTask, photo?: string) {
    try {
      completeTask(p, photo);
      notify(`✅ "${p.task.title}" quedó atendido.`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "No se pudo.", "error");
    }
  }

  function startBlindNow() {
    try {
      openBlindWindow();
      setOpen(false);
    } catch (e) {
      notify(e instanceof Error ? e.message : "No se pudo.", "error");
    }
  }

  return (
    <>
      {visible && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-[10vh]">
          <div className="w-full max-w-lg rounded-3xl border-2 border-violet-500 bg-zinc-950 p-5 text-white shadow-[0_0_60px_rgba(139,92,246,0.5)]">
            <p className="text-sm font-black text-violet-300">✅ Productividad</p>
            <div className="mt-3 space-y-3">
              {state.messages.map((m) => (
                <div key={m.id} className="rounded-2xl border border-sky-500/50 bg-sky-500/10 p-4">
                  <p className="text-xs font-black text-sky-300">💬 Mensaje de {m.from}</p>
                  <p className="mt-1 text-lg font-black">{m.text}</p>
                  <button onClick={() => ackMessage(m.id)} className="mt-3 w-full rounded-xl bg-sky-500 px-4 py-2 font-black text-black">
                    Enterado
                  </button>
                </div>
              ))}
              {state.blind && (
                <div className="rounded-2xl border border-orange-500/60 bg-orange-500/10 p-4">
                  <p className="text-lg font-black">📦 Inventario ciego</p>
                  <button onClick={startBlindNow} className="mt-3 w-full rounded-xl bg-orange-500 px-4 py-2 font-black text-black">
                    {state.blind.count?.status === "en curso" ? "Continuar" : "Empezar"}
                  </button>
                </div>
              )}
              {state.tasks.map((p) => (
                <div key={p.key} className="rounded-2xl border border-violet-500/40 bg-violet-500/10 p-4">
                  <p className="text-xs font-black text-violet-300">
                    {p.task.kind === "lista" ? "📝 Lista de tareas" : "⏰ Recordatorio"} · {new Date(p.slot).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" })}
                  </p>
                  <p className="mt-1 text-lg font-black">{p.task.title}</p>
                  {p.task.kind === "lista" ? (
                    <button onClick={() => { setOpen(false); router.push("/productividad"); }} className="mt-3 w-full rounded-xl bg-violet-500 px-4 py-2 font-black text-black">
                      Abrir la lista
                    </button>
                  ) : (
                    <button onClick={() => (p.task.evidence ? setEvidenceFor(p) : done(p))} className="mt-3 w-full rounded-xl bg-violet-500 px-4 py-2 font-black text-black">
                      {p.task.evidence ? "📸 Ya lo hice (subir foto)" : "✅ Ya lo hice"}
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={() => { setOpen(false); router.push("/productividad"); }} className="rounded-2xl border border-zinc-700 px-4 py-3 text-sm font-black text-zinc-200">
                Ver Productividad
              </button>
              <button onClick={() => setOpen(false)} className="rounded-2xl border border-zinc-700 px-4 py-3 text-sm font-black text-zinc-400">
                Después
              </button>
            </div>
          </div>
        </div>
      )}
      {evidenceFor && (
        <EvidenceDialog
          title={evidenceFor.task.title}
          onClose={() => setEvidenceFor(null)}
          onDone={(photo) => {
            done(evidenceFor, photo);
            setEvidenceFor(null);
          }}
        />
      )}
    </>
  );
}
