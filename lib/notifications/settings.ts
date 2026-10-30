"use client";
/**
 * Avisos de B-POS a gusto del negocio (Configuración → Notificaciones, solo
 * Admin): por cada aviso, el sonido, cuántas veces suena, el color del
 * recuadro del logo, si parpadea y si se repite hasta que alguien lo atienda.
 * Se guarda para todo el negocio ("bpos_notification_settings"), así todas
 * las cajas avisan igual.
 */
export type AlertKind = "online-order" | "delivery-equivalences" | "inventory-warning" | "critical-error";

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

export const ALERT_LABELS: Record<AlertKind, { title: string; hint: string }> = {
  "online-order": { title: "🌐 Pedido del menú digital", hint: "Cuando un cliente manda un pedido desde tu menú en línea." },
  "delivery-equivalences": { title: "🔗 Equivalencias de delivery", hint: "Un pedido de DiDi, Uber o Rappi trae un producto sin equivalencia." },
  "inventory-warning": { title: "📦 Inventario bajo", hint: "Un insumo llegó a su mínimo." },
  "critical-error": { title: "🚨 Error crítico", hint: "Algo falló (por ejemplo, un pedido no llegó a Cocina)." },
};

export const BUILTIN_SOUNDS = [
  { src: "/sounds/BPOS_Recordatorio_Menu_Digital.mp3", name: "Voz: Recordatorio de B-POS" },
  { src: "/sounds/BPOS_Official_Delivery_Equivalences.wav", name: "Tono de equivalencias" },
  { src: "/sounds/BPOS_Official_Inventory_Warning.wav", name: "Tono de inventario" },
  { src: "/sounds/BPOS_Official_Critical_Error.wav", name: "Tono de error crítico" },
];

export const DEFAULT_ALERTS: Record<AlertKind, AlertPref> = {
  "online-order": { sound: BUILTIN_SOUNDS[0].src, times: 1, color: "#22c55e", blink: true, repeat: true, every: 30 },
  "delivery-equivalences": { sound: BUILTIN_SOUNDS[1].src, times: 1, color: "#22c55e", blink: true, repeat: true, every: 2 },
  "inventory-warning": { sound: BUILTIN_SOUNDS[2].src, times: 1, color: "#facc15", blink: false, repeat: false, every: 60 },
  "critical-error": { sound: BUILTIN_SOUNDS[3].src, times: 1, color: "#ef4444", blink: true, repeat: false, every: 60 },
};

const KINDS = Object.keys(DEFAULT_ALERTS) as AlertKind[];

function normalizePref(raw: Partial<AlertPref> | undefined, fallback: AlertPref): AlertPref {
  const r = raw || {};
  const sound = typeof r.sound === "string" && (r.sound.startsWith("/sounds/") || /^https:\/\/\S+$/.test(r.sound)) ? r.sound : fallback.sound;
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

/** Suena el aviso las veces configuradas, una tras otra. */
export function playAlert(pref: Pick<AlertPref, "sound" | "times">) {
  if (!pref.times) return;
  const audio = new Audio(pref.sound);
  let played = 1;
  audio.addEventListener("ended", () => {
    if (played++ < pref.times) void audio.play().catch(() => {});
  });
  void audio.play().catch(() => {});
}
