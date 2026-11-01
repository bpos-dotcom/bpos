"use client";
/**
 * Modo claro u oscuro elegido por quien ve el menú digital o el kiosco (botón
 * ☀️/🌙 en la pantalla). Se guarda en este navegador; sin elección, manda el
 * tema configurado por el negocio (Configuración → Menú digital → Diseño).
 * En el kiosco se borra al volver a la pantalla de inicio: cada cliente
 * empieza con el tema del negocio.
 */
import type { MenuTheme } from "@/lib/digital-menu";

const KEY = "bpos_menu_theme";

export function readThemeChoice(): MenuTheme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
}

export function saveThemeChoice(theme: MenuTheme | null) {
  try {
    if (theme) localStorage.setItem(KEY, theme);
    else localStorage.removeItem(KEY);
  } catch {
    // sin almacenamiento (modo privado): solo dura mientras la página esté abierta
  }
}
