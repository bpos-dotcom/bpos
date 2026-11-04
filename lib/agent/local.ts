"use client";
/**
 * B-POS Agent en esta misma computadora (http://127.0.0.1:4850).
 *
 * Si la caja y el Agent están en la misma PC, las órdenes (imprimir, abrir
 * el cajón) van directo al Agent, sin pasar por la nube: más rápido y
 * funciona sin internet. Antes de usarlo se comprueba (con internet) que
 * ese Agent es de esta sucursal y no el de una pantalla de kiosco; la
 * comprobación queda guardada en este equipo para cuando no hay internet.
 * Agents viejos (antes de 2.0.11) no dicen su id y siguen por la nube.
 */
import { listAgents } from "@/lib/agent/client";

export const LOCAL_AGENT_URL = "http://127.0.0.1:4850";
const VERIFIED_KEY = "bpos_local_agent"; // solo de este dispositivo (ver DEVICE_LOCAL_KEYS)
const RECHECK_MS = 30_000;

type Verified = { agentId: string; branchId: string; at: string };

let cache: { at: number; ok: boolean } | null = null;
let pending: Promise<boolean> | null = null;

function readVerified(): Verified | null {
  try {
    return JSON.parse(localStorage.getItem(VERIFIED_KEY) || "null") as Verified | null;
  } catch {
    return null;
  }
}

function currentBranch() {
  try {
    return localStorage.getItem("bpos_branch_id") || "";
  } catch {
    return "";
  }
}

async function check(): Promise<boolean> {
  let info: { service?: string; agentId?: string } | null = null;
  try {
    const r = await fetch(`${LOCAL_AGENT_URL}/`, { signal: AbortSignal.timeout(900), cache: "no-store" });
    info = (await r.json()) as { service?: string; agentId?: string };
  } catch {
    return false; // no hay Agent en esta computadora (o es un Agent viejo que no deja a B-POS hablarle)
  }
  if (info?.service !== "B-POS Agent" || !info.agentId) return false;
  const branchId = currentBranch();
  const verified = readVerified();
  if (verified && verified.agentId === info.agentId && verified.branchId === branchId) return true;
  // Primera vez (o cambió de sucursal): se comprueba con la nube; sin internet no se usa
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  try {
    const agents = await listAgents();
    const mine = agents.find((a) => a.id === info.agentId && !a.kiosk_id);
    if (!mine) {
      localStorage.removeItem(VERIFIED_KEY);
      return false;
    }
    localStorage.setItem(VERIFIED_KEY, JSON.stringify({ agentId: info.agentId, branchId, at: new Date().toISOString() } satisfies Verified));
    return true;
  } catch {
    return false;
  }
}

/** ¿Hay un Agent de esta sucursal en esta computadora? (se revisa cada 30 s como máximo) */
export function hasLocalAgent(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (cache && Date.now() - cache.at < RECHECK_MS) return Promise.resolve(cache.ok);
  if (!pending) {
    pending = check()
      .then((ok) => {
        cache = { at: Date.now(), ok };
        return ok;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

/** Después de un error de red con el Agent local: volver a revisar la próxima vez */
export function forgetLocalAgent() {
  cache = null;
}

/** Manda la orden al Agent local; lanza error de red si no responde (para intentar por la nube). */
export async function callLocalAgent<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${LOCAL_AGENT_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  const payload = (await response.json().catch(() => ({}))) as T;
  return payload;
}
