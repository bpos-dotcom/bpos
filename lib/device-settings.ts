"use client";
/**
 * Ajustes de ESTE dispositivo (no se sincronizan: cada caja decide).
 * Configuración → Punto de venta.
 */
const TOUCH_KEY = "bpos_touch_keypad"; // ver DEVICE_LOCAL_KEYS
const WHATSAPP_APP_KEY = "bpos_whatsapp_app"; // ver DEVICE_LOCAL_KEYS
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

/** WhatsApp se abre en la aplicación de escritorio (whatsapp://) en vez del navegador. */
export function whatsappAppEnabled() {
  try {
    return localStorage.getItem(WHATSAPP_APP_KEY) === "1";
  } catch {
    return false;
  }
}

export function setWhatsappApp(enabled: boolean) {
  try {
    localStorage.setItem(WHATSAPP_APP_KEY, enabled ? "1" : "0");
  } catch {}
  window.dispatchEvent(new Event(DEVICE_SETTINGS_EVENT));
}
