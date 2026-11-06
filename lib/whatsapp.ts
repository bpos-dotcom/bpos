"use client";
/**
 * Ligas de WhatsApp con el número y el mensaje ya escritos (gratis, sin API).
 *
 * Cada dispositivo elige cómo se abren (Configuración → Sistema):
 * - Navegador (de fábrica): api.whatsapp.com en pestaña nueva; en celular abre la app sola.
 * - Aplicación: whatsapp:// abre directo WhatsApp de escritorio, sin pasar por el navegador
 *   (si la PC no tiene la app instalada no se abre nada; por eso no es lo de fábrica).
 */
import { whatsappAppEnabled } from "./device-settings";

const APP_SCHEME = "whatsapp:";

/** Liga para mandar `text` a `phone` (solo dígitos, con lada de país) */
export function whatsappLink(phone: string, text = "") {
  const message = text ? `&text=${encodeURIComponent(text)}` : "";
  return whatsappAppEnabled() ? `whatsapp://send?phone=${phone}${message}` : `https://api.whatsapp.com/send/?phone=${phone}${message}`;
}

/** Para `<a target>`: la app se abre sin dejar una pestaña vacía */
export function whatsappTarget(url: string) {
  return url.startsWith(APP_SCHEME) ? undefined : "_blank";
}

/**
 * Abre la liga en el mismo clic (si no, el navegador la bloquea).
 * Regresa false si el navegador bloqueó la pestaña nueva.
 */
export function openWhatsapp(url: string) {
  if (url.startsWith(APP_SCHEME)) {
    window.location.href = url;
    return true;
  }
  return Boolean(window.open(url, "_blank"));
}
