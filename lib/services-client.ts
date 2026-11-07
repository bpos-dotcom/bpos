"use client";
/**
 * Servicios del negocio en este navegador: si la cuenta es "solo servicios"
 * y cuáles tiene vigentes. Se piden a /api/servicios y se recuerdan aquí
 * (sin internet se usa lo último que se supo).
 */
import { useEffect, useState } from "react";
import { aiFetch } from "@/lib/ai/client";
import { openServices, type CatalogEntry, type ServiceId, type ServiceRow } from "@/lib/services";
import { isCloudConfigured } from "@/lib/supabase/client";

const KEY = "bpos_services_state";
export const SERVICES_EVENT = "bpos:services-updated";

export type ServicesState = { kind: "pos" | "servicios"; catalog: CatalogEntry[]; services: ServiceRow[]; billing: boolean; at: number };

export function readServicesState(): ServicesState | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
}

function remember(state: ServicesState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
  window.dispatchEvent(new Event(SERVICES_EVENT));
}

/** Llama a /api/servicios; con éxito recuerda el estado nuevo */
export async function servicesCall(body: Record<string, unknown>) {
  const r = await aiFetch("/api/servicios", { method: "POST", body: JSON.stringify(body) });
  const b = (await r.json().catch(() => ({}))) as Partial<ServicesState> & { success?: boolean; error?: string; url?: string };
  if (!r.ok || !b.success) throw new Error(b.error || "No se pudo. Intenta otra vez.");
  if (b.catalog && b.services) remember({ kind: b.kind === "servicios" ? "servicios" : "pos", catalog: b.catalog, services: b.services, billing: Boolean(b.billing), at: Date.now() });
  return b;
}

// Varias partes de la pantalla piden el estado al abrir: una sola consulta a la vez y no más de una por minuto
let inFlight: Promise<unknown> | null = null;
let lastAt = 0;
export function refreshServices(force = false) {
  if (inFlight) return inFlight;
  if (!force && Date.now() - lastAt < 60_000) return Promise.resolve(readServicesState());
  lastAt = Date.now();
  inFlight = servicesCall({ accion: "estado" }).finally(() => (inFlight = null));
  return inFlight;
}

/** ¿Esta cuenta es solo de servicios? (lo último que se supo) */
export const isServicesAccount = () => readServicesState()?.kind === "servicios";

/** Servicios vigentes ahora (lo último que se supo) */
export const openServiceIds = (state = readServicesState()): ServiceId[] => (state ? openServices(state.services) : []);

/** Estado de los servicios; se consulta al abrir y cada 15 min */
export function useServicesState() {
  const [state, setState] = useState<ServicesState | null>(() => readServicesState());
  useEffect(() => {
    const sync = () => setState(readServicesState());
    window.addEventListener(SERVICES_EVENT, sync);
    let timer: ReturnType<typeof setInterval> | undefined;
    if (isCloudConfigured) {
      const load = () => void refreshServices().catch(() => undefined);
      load();
      timer = setInterval(load, 15 * 60_000);
    }
    return () => {
      window.removeEventListener(SERVICES_EVENT, sync);
      if (timer) clearInterval(timer);
    };
  }, []);
  return state;
}
