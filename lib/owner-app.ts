"use client";
/**
 * Bloque 12 · App del dueño: instalación como app y notificaciones.
 *
 * Las notificaciones salen de este dispositivo cuando la app detecta una
 * venta grande o una alerta crítica nueva (con la app abierta o en segundo
 * plano). Las notificaciones push con la app cerrada necesitan un servidor
 * que las envíe; el service worker (public/sw.js) ya las sabe mostrar.
 */

const NOTIFY_KEY = "bpos_owner_notify"; // solo de este dispositivo (no se sincroniza)

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let installPrompt: InstallPromptEvent | null = null;
const installListeners = new Set<() => void>();

/** Registra el service worker y escucha la oferta de instalación de Android/Chrome. */
export function setupOwnerApp() {
  if (typeof window === "undefined") return;
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
  }
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event as InstallPromptEvent;
    installListeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    installListeners.forEach((l) => l());
  });
}

export function onInstallAvailable(listener: () => void) {
  installListeners.add(listener);
  return () => installListeners.delete(listener);
}

export function canPromptInstall() {
  return installPrompt !== null;
}

export async function promptInstall() {
  if (!installPrompt) return false;
  await installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  installListeners.forEach((l) => l());
  return outcome === "accepted";
}

/** true si ya corre como app instalada (sin barra del navegador) */
export function isInstalled() {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

export function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
}

export function notificationsEnabled() {
  if (!notificationsSupported()) return false;
  try {
    return Notification.permission === "granted" && localStorage.getItem(NOTIFY_KEY) === "1";
  } catch {
    return false;
  }
}

export async function enableNotifications() {
  if (!notificationsSupported()) return false;
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return false;
  localStorage.setItem(NOTIFY_KEY, "1");
  await notifyOwner({ title: "B-POS", body: "Listo: aquí te avisaremos de alertas críticas y ventas.", tag: "bpos-test" });
  return true;
}

export function disableNotifications() {
  localStorage.removeItem(NOTIFY_KEY);
}

export async function notifyOwner(n: { title: string; body: string; tag?: string; url?: string }) {
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  const options: NotificationOptions = {
    body: n.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: n.tag,
    data: { url: n.url || "/dueno" },
  };
  try {
    // .ready nunca termina si el service worker no se pudo registrar
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("sin service worker")), 3000)),
    ]);
    await registration.showNotification(n.title, options);
  } catch {
    new Notification(n.title, options);
  }
}
