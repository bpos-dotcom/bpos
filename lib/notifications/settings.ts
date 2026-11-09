"use client";
/**
 * Avisos de B-POS a gusto del negocio (Configuración → Notificaciones, solo
 * Admin): por cada aviso, el sonido, cuántas veces suena, el color del
 * recuadro del logo, si parpadea y si se repite hasta que alguien lo atienda.
 * Se guarda para todo el negocio ("bpos_notification_settings"), así todas
 * las cajas avisan igual.
 */
import { SUPABASE_URL } from "@/lib/supabase/client";

/** Audios subidos por el administrador de B-POS (nube de B-POS) */
const MEDIA_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/bpos-media/`;

export type AlertKind = "online-order" | "delivery-equivalences" | "inventory-warning" | "critical-error" | "shift-message" | "productivity-task" | "blind-inventory";

export type AlertPref = {
  /** Dirección del audio (de B-POS o subido por el negocio) */
  sound: string;
  /** Cuántas veces suena seguido (1 a 5); 0 = sin sonido */
  times: number;
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
  { src: "/sounds/BPOS_Recordatorio_Menu_Digital.mp3", name: "Voz: Recordatorio de B-POS" },
  { src: "/sounds/BPOS_Official_Delivery_Equivalences.wav", name: "Tono de equivalencias" },
  { src: "/sounds/BPOS_Official_Inventory_Warning.wav", name: "Tono de inventario" },
  { src: "/sounds/BPOS_Official_Critical_Error.wav", name: "Tono de error crítico" },
];

export const DEFAULT_ALERTS: Record<AlertKind, AlertPref> = {
  "online-order": { sound: BUILTIN_SOUNDS[1].src, times: 1, color: "#22c55e", blink: true, repeat: true, every: 30 },
  "delivery-equivalences": { sound: BUILTIN_SOUNDS[2].src, times: 1, color: "#22c55e", blink: true, repeat: true, every: 2 },
  "inventory-warning": { sound: BUILTIN_SOUNDS[3].src, times: 1, color: "#facc15", blink: false, repeat: false, every: 60 },
  "critical-error": { sound: BUILTIN_SOUNDS[4].src, times: 1, color: "#ef4444", blink: true, repeat: false, every: 60 },
  "shift-message": { sound: BEEP_SOUND, times: 1, color: "#0ea5e9", blink: true, repeat: false, every: 60 },
  "productivity-task": { sound: BEEP_SOUND, times: 1, color: "#8b5cf6", blink: true, repeat: false, every: 60 },
  "blind-inventory": { sound: BEEP_SOUND, times: 1, color: "#f97316", blink: true, repeat: false, every: 60 },
};

const KINDS = Object.keys(DEFAULT_ALERTS) as AlertKind[];

function normalizePref(raw: Partial<AlertPref> | undefined, fallback: AlertPref): AlertPref {
  const r = raw || {};
  // Solo audios de B-POS o los que subió el administrador de B-POS a su nube
  const sound = typeof r.sound === "string" && (r.sound === BEEP_SOUND || /^\/sounds\/[\w.-]+$/.test(r.sound) || (r.sound.startsWith(MEDIA_PREFIX) && !/\s/.test(r.sound))) ? r.sound : fallback.sound;
  return {
    sound,
    times: Number.isFinite(Number(r.times)) ? Math.min(5, Math.max(0, Math.round(Number(r.times)))) : fallback.times,
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

/** Suena el aviso las veces configuradas, una tras otra. Se resuelve al terminar. */
export function playAlert(pref: Pick<AlertPref, "sound" | "times">): Promise<void> {
  if (!pref.times) return Promise.resolve();
  if (pref.sound === BEEP_SOUND) {
    const ms = beep(pref.times);
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
  return new Promise((resolve) => {
    const audio = new Audio(pref.sound);
    let played = 1;
    // Por si el audio no carga o el navegador no lo deja sonar
    const fallback = window.setTimeout(resolve, 15_000);
    const done = () => {
      window.clearTimeout(fallback);
      resolve();
    };
    audio.addEventListener("ended", () => {
      if (played++ < pref.times) void audio.play().catch(done);
      else done();
    });
    audio.addEventListener("error", done);
    void audio.play().catch(done);
  });
}
