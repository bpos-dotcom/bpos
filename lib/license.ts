"use client";
/**
 * Permiso de uso (candado contra usar B-POS sin pagar), del lado de B-POS.
 *
 * Con internet se pide a /api/licencia un permiso firmado por el servidor:
 * "este negocio puede trabajar hasta tal fecha" (lo pagado o la prueba, y
 * como máximo 3 días). Sin internet B-POS sigue mientras ese permiso esté
 * vigente; después pide conectarse. Si el reloj de la computadora se
 * atrasa (para alargarlo), también lo pide. La firma se revisa con la
 * llave pública: nadie puede inventar ni alargar un permiso.
 */
import * as ed from "@noble/ed25519";
import { getSupabase, isCloudConfigured } from "@/lib/supabase/client";

/** Llave pública del servidor (GET /api/licencia/llave). Vacía = aún no se revisa. */
export const LICENSE_PUBLIC_KEY = "5KjkNdsNnFPRuouWuBRTMsR-hIT4YaZMDt5BxViQ1uU";

const KEY = "bpos_license"; // solo de este dispositivo (ver DEVICE_LOCAL_KEYS)
const SEEN_KEY = "bpos_license_seen";
const EVER_KEY = "bpos_license_ever";
/** Diferencia entre la hora del servidor y la de este equipo (ms) al recibir el permiso */
const OFFSET_KEY = "bpos_license_offset";
const CLOCK_TOLERANCE_MS = 15 * 60 * 1000;

export type LicensePayload = { b: string; u: number; i: number; l: boolean };
export type LicenseStatus = { ok: true; until?: number } | { ok: false; reason: "vencido" | "reloj" | "sin-permiso" | "firma" | "plan"; until?: number };

const fromB64url = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function verify(token: string): Promise<LicensePayload | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig || !LICENSE_PUBLIC_KEY) return null;
  try {
    const ok = await ed.verifyAsync(fromB64url(sig), fromB64url(body), fromB64url(LICENSE_PUBLIC_KEY));
    if (!ok) return null;
    return JSON.parse(new TextDecoder().decode(fromB64url(body))) as LicensePayload;
  } catch {
    return null;
  }
}

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // sin almacenamiento
  }
}

/** Registra la hora más reciente vista (para detectar si atrasan el reloj) */
function touchClock(now: number) {
  const seen = Number(read(SEEN_KEY) || 0);
  if (now > seen) write(SEEN_KEY, String(now));
  return seen;
}

/** Pide un permiso nuevo al servidor (con internet). */
export async function refreshLicense(): Promise<boolean> {
  if (!isCloudConfigured || typeof navigator === "undefined" || !navigator.onLine) return false;
  try {
    const { data } = await getSupabase().auth.getSession();
    const session = data.session?.access_token;
    if (!session) return false;
    const response = await fetch("/api/licencia", { method: "POST", headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json" }, body: "{}" });
    const payload = (await response.json().catch(() => ({}))) as { success?: boolean; token?: string };
    if (!response.ok || !payload.success || !payload.token) return false;
    write(KEY, payload.token);
    write(EVER_KEY, "1");
    // Los 3 días se cuentan con la hora del servidor: un reloj mal puesto (o atrasado a propósito
    // antes de renovar) no da más días ni bloquea por error
    const issued = (await verify(payload.token))?.i;
    const local = Date.now();
    if (issued) write(OFFSET_KEY, String(issued - local));
    write(SEEN_KEY, String(local));
    return true;
  } catch {
    return false;
  }
}

/** ¿Puede trabajar este equipo ahora? (sin red: solo lo guardado) */
export async function licenseStatus(now = Date.now()): Promise<LicenseStatus> {
  if (!isCloudConfigured || !LICENSE_PUBLIC_KEY) return { ok: true };
  const seen = touchClock(now);
  if (seen && now < seen - CLOCK_TOLERANCE_MS) return { ok: false, reason: "reloj" };
  const token = read(KEY);
  if (!token) return read(EVER_KEY) ? { ok: false, reason: "sin-permiso" } : { ok: true }; // recién actualizado: se pide al conectarse
  const payload = await verify(token);
  if (!payload) return { ok: false, reason: "firma" };
  if (payload.l) return { ok: false, reason: "plan", until: payload.u };
  if (now + Number(read(OFFSET_KEY) || 0) > payload.u) return { ok: false, reason: "vencido", until: payload.u };
  return { ok: true, until: payload.u };
}
