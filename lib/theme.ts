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

/** El menú digital (/m/...) y el club (/fidelidad/...) son de los clientes: tienen sus propios colores y no usan el tema de B-POS */
const isPublicMenu = () => window.location.pathname.startsWith("/m/") || window.location.pathname.startsWith("/fidelidad/");

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("theme-light", theme === "light" && !isPublicMenu());
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
  applyTheme(theme);
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Se pone en <head> para que la página no parpadee en oscuro antes de cargar. */
export const THEME_BOOT_SCRIPT = `try{if(localStorage.getItem("${THEME_KEY}")==="light"&&location.pathname.indexOf("/m/")!==0&&location.pathname.indexOf("/fidelidad/")!==0)document.documentElement.classList.add("theme-light")}catch(e){}`;
