"use client";
/**
 * Kiosco (pantalla táctil del local) del lado del navegador: la llave de la
 * pantalla guardada en este equipo y las llamadas a /api/kiosco/*.
 */

export type KioskSession = {
  token: string;
  kioskId: string;
  name: string;
  slug: string;
  business: { name: string; logo: string; color: string };
  branch: string;
};

const KEY = "bpos_kiosk";

export function readKioskSession(): KioskSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as KioskSession;
    return s && typeof s.token === "string" && s.token.length === 64 ? s : null;
  } catch {
    return null;
  }
}

export function saveKioskSession(session: KioskSession | null) {
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify(session));
    else localStorage.removeItem(KEY);
  } catch {}
}

export class KioskRequestError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Llamada al servidor con la llave de la pantalla; el error trae el mensaje para el cliente. */
export async function kioskFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = readKioskSession();
  const headers = new Headers(init.headers);
  if (session) headers.set("x-kiosk-token", session.token);
  if (init.body) headers.set("content-type", "application/json");
  const r = await fetch(path, { ...init, headers, cache: "no-store" });
  const b = await r.json().catch(() => null);
  if (!r.ok || !b?.success) throw new KioskRequestError(b?.error || (r.status === 403 && !b ? "La página está protegida: revisa el firewall de Vercel." : "No se pudo."), r.status);
  return b as T;
}

/** Lo que la pantalla avisa mientras cobra (para no volver al inicio a media transacción) */
export const KIOSK_BUSY_EVENT = "bpos:kiosk-busy";
export function setKioskBusy(busy: boolean) {
  window.dispatchEvent(new CustomEvent(KIOSK_BUSY_EVENT, { detail: busy }));
}
