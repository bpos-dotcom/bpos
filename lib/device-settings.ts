"use client";
/**
 * Ajustes de ESTE dispositivo (no se sincronizan: cada caja decide).
 * Configuración → Punto de venta.
 */
const TOUCH_KEY = "bpos_touch_keypad"; // ver DEVICE_LOCAL_KEYS
export const DEVICE_SETTINGS_EVENT = "bpos:device-settings-updated";

/** Pantalla táctil: los montos se capturan con un teclado numérico en pantalla. */
export function touchKeypadEnabled() {
  try {
    return localStorage.getItem(TOUCH_KEY) === "1";
  } catch {
    return false;
  }
}

export function setTouchKeypad(enabled: boolean) {
  try {
    localStorage.setItem(TOUCH_KEY, enabled ? "1" : "0");
  } catch {}
  window.dispatchEvent(new Event(DEVICE_SETTINGS_EVENT));
}
