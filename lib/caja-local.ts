"use client";
/**
 * Caja local: B-POS abierto en la ventana de B-POS Agent (2.0.24+) en vez de
 * Chrome. Es la misma página, pero lo que el navegador guardaba en su
 * memoria (5-10 MB, se llenaba y trababa la pantalla) se guarda en el disco
 * de la computadora (bpos-agent/lib/caja-local.js).
 *
 * Para pasarse, desde el Chrome de la caja se manda todo lo guardado al
 * Agent una sola vez. Después ese Chrome queda marcado (MOVED_KEY) y ya no
 * trabaja como caja, para no tener dos cajas con el mismo dispositivo.
 */
import { LOCAL_AGENT_URL } from "@/lib/agent/local";

/** Solo de este navegador: no empieza con "bpos_", no se sincroniza */
export const MOVED_KEY = "caja_local_moved";

export type AgentCajaInfo = { version: number; enabled: boolean; hasData: boolean; open: boolean };

/** ¿Esta pantalla ya es la caja local (ventana del Agent)? */
export function isCajaLocal() {
  return typeof window !== "undefined" && Boolean((window as unknown as { bposCajaLocal?: unknown }).bposCajaLocal);
}

/** Solo de este equipo (no empieza con "bpos_", no se sincroniza): cuándo empezó a ser caja local */
export const SINCE_KEY = "caja_local_since";

/**
 * Desde cuándo esta ventana del Agent es la caja (se anota la primera vez).
 * Sirve para saber desde qué día tiene completas las ventas y el kardex: al
 * pasarse trae solo lo que tenía el navegador (10 días de ventas, 2 de
 * kardex) y de ahí va juntando hasta 30.
 */
export function cajaLocalSince(now = new Date()): Date | null {
  if (!isCajaLocal()) return null;
  try {
    const saved = window.localStorage.getItem(SINCE_KEY);
    const at = saved ? Date.parse(saved) : NaN;
    if (Number.isFinite(at)) return new Date(at);
    window.localStorage.setItem(SINCE_KEY, now.toISOString());
  } catch {
    // sin memoria: se cuenta desde hoy
  }
  return now;
}

/** ¿Este navegador ya se pasó a la caja local? */
export function movedToCajaLocal() {
  if (typeof window === "undefined" || isCajaLocal()) return false;
  try {
    return Boolean(window.localStorage.getItem(MOVED_KEY));
  } catch {
    return false;
  }
}

/** El Agent de esta computadora, si ya trae la caja local (null = no hay o es viejo) */
export async function agentCajaInfo(): Promise<AgentCajaInfo | null> {
  try {
    const r = await fetch(`${LOCAL_AGENT_URL}/`, { signal: AbortSignal.timeout(1500), cache: "no-store" });
    const info = (await r.json()) as { service?: string; cajaLocal?: AgentCajaInfo };
    return info?.service === "B-POS Agent" && info.cajaLocal ? info.cajaLocal : null;
  } catch {
    return null;
  }
}

/** Todo lo que este navegador tiene guardado (menos la marca de "ya se pasó") */
export function collectEntries(storage: Pick<Storage, "length" | "key" | "getItem"> = window.localStorage) {
  const entries: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key === null || key === MOVED_KEY) continue;
    const value = storage.getItem(key);
    if (value !== null) entries[key] = value;
  }
  return entries;
}

export type MoveResult = { ok: true; count: number } | { ok: false; conflict?: boolean; error: string };

/** Manda lo de este navegador al Agent y abre la caja local */
export async function moveToCajaLocal({ replace = false } = {}): Promise<MoveResult> {
  const entries = collectEntries();
  let r: Response;
  try {
    r = await fetch(`${LOCAL_AGENT_URL}/caja-local/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entries, replace }),
    });
  } catch {
    return { ok: false, error: "No se pudo hablar con B-POS Agent en esta computadora. Revisa que esté abierto (junto al reloj)." };
  }
  const body = (await r.json().catch(() => ({}))) as { success?: boolean; conflict?: boolean; count?: number; error?: string };
  if (r.status === 409 || body.conflict) return { ok: false, conflict: true, error: body.error || "La caja local ya tiene datos." };
  if (!r.ok || !body.success) return { ok: false, error: body.error || `B-POS Agent respondió ${r.status}.` };
  try {
    window.localStorage.setItem(MOVED_KEY, new Date().toISOString());
  } catch {
    /* sin espacio: igual ya se pasó */
  }
  return { ok: true, count: body.count ?? Object.keys(entries).length };
}

/** Abre (o trae al frente) la ventana de la caja local */
export async function openCajaLocal() {
  try {
    const r = await fetch(`${LOCAL_AGENT_URL}/caja-local/open`, { method: "POST" });
    return r.ok;
  } catch {
    return false;
  }
}
