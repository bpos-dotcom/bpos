"use client";
/**
 * Avisos de B-POS a gusto del negocio (Configuración → Notificaciones, solo
 * Admin): por cada aviso, el sonido, cuántas veces suena, el color del
 * recuadro del logo, si parpadea y si se repite hasta que alguien lo atienda.
 * Se guarda para todo el negocio ("bpos_notification_settings"), así todas
 * las cajas avisan igual.
 */
import { SUPABASE_URL } from "@/lib/supabase/client";
import { SYNTH_SOUNDS, isSynthSound, playSynth } from "./synth";

/** Audios subidos por el administrador de B-POS (nube de B-POS) */
const MEDIA_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/bpos-media/`;

export type AlertKind = "online-order" | "delivery-equivalences" | "inventory-warning" | "critical-error" | "shift-message" | "productivity-task" | "blind-inventory";

export type AlertPref = {
  /** Dirección del audio (de B-POS o subido por el negocio) */
  sound: string;
  /** Cuántas veces suena (1 a 10); 0 = sin sonido */
  times: number;
  /** Segundos de espera entre una vez y la siguiente (0 = seguido) */
  gap: number;
  /** Color del recuadro del logo */
  color: string;
  /** El recuadro parpadea */
  blink: boolean;
  /** Vuelve a sonar cada `every` segundos hasta que se atienda */
  repeat: boolean;
  every: number;
};

export const NOTIFICATION_SETTINGS_KEY = "bpos_notification_settings";
export const NOTIFICATION_SETTINGS_EVENT = "bpos:notification-settings-updated";

/** fixedRepeat: cada cuánto insiste lo decide el dueño en su app (Productividad), no aquí */
export const ALERT_LABELS: Record<AlertKind, { title: string; hint: string; fixedRepeat?: boolean }> = {
  "online-order": { title: "🌐 Pedido del menú digital", hint: "Cuando un cliente manda un pedido desde tu menú en línea." },
  "delivery-equivalences": { title: "🔗 Equivalencias de delivery", hint: "Un pedido de DiDi, Uber o Rappi trae un producto sin equivalencia." },
  "inventory-warning": { title: "📦 Inventario bajo", hint: "Un insumo llegó a su mínimo." },
  "critical-error": { title: "🚨 Error crítico", hint: "Algo falló (por ejemplo, un pedido no llegó a Cocina)." },
  "shift-message": { title: "💬 Mensaje del turno", hint: "Un mensaje que mandó el dueño desde su app. Después del sonido, la voz lee el mensaje.", fixedRepeat: true },
  "productivity-task": { title: "⏰ Recordatorio o lista de tareas", hint: "Un recordatorio de Productividad. Después del sonido, la voz lo lee.", fixedRepeat: true },
  "blind-inventory": { title: "📦 Inventario ciego", hint: "Toca inventario ciego. Después del sonido, la voz dice el texto que puso el dueño.", fixedRepeat: true },
};

/** Pip pip pip generado por B-POS (no es un archivo) */
export const BEEP_SOUND = "beep";

export const BUILTIN_SOUNDS = [
  { src: BEEP_SOUND, name: "Pip pip pip" },
  ...SYNTH_SOUNDS,
  { src: "/sounds/BPOS_Recordatorio_Menu_Digital.mp3", name: "Voz: Recordatorio de B-POS" },
  { src: "/sounds/BPOS_Official_Delivery_Equivalences.wav", name: "Tono de equivalencias" },
  { src: "/sounds/BPOS_Official_Inventory_Warning.wav", name: "Tono de inventario" },
  { src: "/sounds/BPOS_Official_Critical_Error.wav", name: "Tono de error crítico" },
];

export const DEFAULT_ALERTS: Record<AlertKind, AlertPref> = {
  "online-order": { sound: "/sounds/BPOS_Recordatorio_Menu_Digital.mp3", times: 1, gap: 0, color: "#22c55e", blink: true, repeat: true, every: 30 },
  "delivery-equivalences": { sound: "/sounds/BPOS_Official_Delivery_Equivalences.wav", times: 1, gap: 0, color: "#22c55e", blink: true, repeat: true, every: 2 },
  "inventory-warning": { sound: "/sounds/BPOS_Official_Inventory_Warning.wav", times: 1, gap: 0, color: "#facc15", blink: false, repeat: false, every: 60 },
  "critical-error": { sound: "/sounds/BPOS_Official_Critical_Error.wav", times: 1, gap: 0, color: "#ef4444", blink: true, repeat: false, every: 60 },
  "shift-message": { sound: BEEP_SOUND, times: 1, gap: 0, color: "#0ea5e9", blink: true, repeat: false, every: 60 },
  "productivity-task": { sound: BEEP_SOUND, times: 1, gap: 0, color: "#8b5cf6", blink: true, repeat: false, every: 60 },
  "blind-inventory": { sound: BEEP_SOUND, times: 1, gap: 0, color: "#f97316", blink: true, repeat: false, every: 60 },
};

const KINDS = Object.keys(DEFAULT_ALERTS) as AlertKind[];

/** Hasta cuántas veces seguidas puede sonar un aviso */
export const MAX_TIMES = 10;
/** Esperas que se pueden elegir entre una vez y otra (segundos) */
export const GAP_OPTIONS = [0, 1, 2, 3, 5, 10, 15, 20, 30, 60];

function normalizePref(raw: Partial<AlertPref> | undefined, fallback: AlertPref): AlertPref {
  const r = raw || {};
  // Solo audios de B-POS o los que subió el administrador de B-POS a su nube
  const sound = typeof r.sound === "string" && (r.sound === BEEP_SOUND || isSynthSound(r.sound) || /^\/sounds\/[\w.-]+$/.test(r.sound) || (r.sound.startsWith(MEDIA_PREFIX) && !/\s/.test(r.sound))) ? r.sound : fallback.sound;
  return {
    sound,
    times: Number.isFinite(Number(r.times)) ? Math.min(MAX_TIMES, Math.max(0, Math.round(Number(r.times)))) : fallback.times,
    gap: Number.isFinite(Number(r.gap)) ? Math.min(60, Math.max(0, Math.round(Number(r.gap)))) : fallback.gap,
    color: typeof r.color === "string" && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : fallback.color,
    blink: typeof r.blink === "boolean" ? r.blink : fallback.blink,
    repeat: typeof r.repeat === "boolean" ? r.repeat : fallback.repeat,
    every: Number.isFinite(Number(r.every)) ? Math.min(600, Math.max(2, Math.round(Number(r.every)))) : fallback.every,
  };
}

export function getNotificationSettings(): Record<AlertKind, AlertPref> {
  let raw: Partial<Record<AlertKind, Partial<AlertPref>>> = {};
  try {
    raw = JSON.parse(localStorage.getItem(NOTIFICATION_SETTINGS_KEY) || "{}") || {};
  } catch {}
  return Object.fromEntries(KINDS.map((k) => [k, normalizePref(raw[k], DEFAULT_ALERTS[k])])) as Record<AlertKind, AlertPref>;
}

export function saveAlertPref(kind: AlertKind, patch: Partial<AlertPref>) {
  const all = getNotificationSettings();
  all[kind] = normalizePref({ ...all[kind], ...patch }, DEFAULT_ALERTS[kind]);
  localStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(all));
  window.dispatchEvent(new Event(NOTIFICATION_SETTINGS_EVENT));
  return all;
}

/** Pip pip pip con el audio del navegador; regresa cuánto dura (ms) */
function beep(times: number) {
  try {
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return 0;
    const ctx = new Ctx();
    const pips = times * 3;
    for (let i = 0; i < pips; i++) {
      // Tres pips seguidos y una pausa entre cada vez
      const start = ctx.currentTime + i * 0.28 + Math.floor(i / 3) * 0.5;
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
    const ms = pips * 280 + (times - 1) * 500 + 150;
    window.setTimeout(() => void ctx.close(), ms + 300);
    return ms;
  } catch {
    return 0;
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Suena el audio una vez; se resuelve al terminar */
function playOnce(sound: string): Promise<void> {
  if (sound === BEEP_SOUND) return wait(beep(1));
  if (isSynthSound(sound)) return wait(playSynth(sound));
  return new Promise((resolve) => {
    const audio = new Audio(sound);
    // Por si el audio no carga o el navegador no lo deja sonar
    const fallback = window.setTimeout(resolve, 15_000);
    const done = () => {
      window.clearTimeout(fallback);
      resolve();
    };
    audio.addEventListener("ended", done);
    audio.addEventListener("error", done);
    void audio.play().catch(done);
  });
}

/** Suena el aviso las veces configuradas, esperando `gap` segundos entre cada una. Se resuelve al terminar. */
export async function playAlert(pref: Pick<AlertPref, "sound" | "times"> & { gap?: number }): Promise<void> {
  if (!pref.times) return;
  const gap = Math.max(0, Number(pref.gap) || 0) * 1000;
  // El pip pip pip seguido conserva su pausa corta de siempre entre cada vez
  if (pref.sound === BEEP_SOUND && !gap) return wait(beep(pref.times));
  for (let i = 0; i < pref.times; i++) {
    if (i) await wait(gap);
    await playOnce(pref.sound);
  }
}
