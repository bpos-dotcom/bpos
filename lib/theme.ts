"use client";
/**
 * Tema oscuro / claro de ESTE dispositivo (no se sincroniza: cada caja elige).
 * El modo claro invierte la paleta gris en globals.css (html.theme-light), así
 * que las pantallas no necesitan clases distintas.
 */
export type Theme = "dark" | "light";

const THEME_KEY = "bpos_theme"; // ver DEVICE_LOCAL_KEYS
export const THEME_EVENT = "bpos:theme-updated";

export function getTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("theme-light", theme === "light");
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
  applyTheme(theme);
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Se pone en <head> para que la página no parpadee en oscuro antes de cargar. */
export const THEME_BOOT_SCRIPT = `try{if(localStorage.getItem("${THEME_KEY}")==="light")document.documentElement.classList.add("theme-light")}catch(e){}`;
