/**
 * Todo lo que las pantallas le piden a B-POS Agent (imprimir, guardar qué
 * impresora tiene cada estación).
 *   En la nube (B-POS 2.0): por la cola de trabajos (lib/agent/client.ts),
 *   desde cualquier dispositivo del negocio.
 *   Sin nube (pruebas locales): directo al Agent de esta computadora.
 */
import { runAgentJob, type AgentJobKind } from "@/lib/agent/client";
import { callLocalAgent, forgetLocalAgent, hasLocalAgent } from "@/lib/agent/local";
import type { PrintJob } from "@/lib/bridge/printManager";
import { isCloudConfigured } from "@/lib/supabase/client";

const LOCAL_SERVICE_URL = "http://localhost:4850";

const LOCAL_PATHS: Record<AgentJobKind, string> = {
  print: "/print",
  "station-printers": "/station-printers",
  "print-original": "/print-original",
  "print-tickets": "/print-tickets",
  "open-drawer": "/open-drawer",
};

/** Respuesta del Agent; con error si no lo pudo hacer. */
async function callAgent<T extends { success?: boolean; error?: string }>(kind: AgentJobKind, body: unknown, fallbackError: string): Promise<T> {
  if (isCloudConfigured) {
    // Agent en esta misma computadora: directo (sin nube). La configuración de impresoras
    // la toma el Agent de la nube, así que esa sí va por la cola.
    if (kind !== "station-printers" && (await hasLocalAgent())) {
      try {
        const local = await callLocalAgent<T>(LOCAL_PATHS[kind], body);
        if (local.success === false) throw new Error(local.error || fallbackError);
        return local;
      } catch (error) {
        // Error de red: el Agent local no respondió → se intenta por la nube.
        // Error del Agent (ej. sin impresora): ese es el resultado, no se repite.
        if (!(error instanceof TypeError) && !(error instanceof DOMException)) throw error;
        forgetLocalAgent();
      }
    }
    const result = await runAgentJob<T>(kind, body);
    if (result.success === false) throw new Error(result.error || fallbackError);
    return result;
  }
  const response = await fetch(`${LOCAL_SERVICE_URL}${LOCAL_PATHS[kind]}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as T;
  if (!response.ok || payload.success === false) throw new Error(payload.error || fallbackError);
  return payload;
}

export async function sendJobToLocalService(job: PrintJob) {
  return callAgent<{ success?: boolean; error?: string; job?: unknown }>("print", job, "No se pudo enviar la comanda al Agent.");
}
export type StationPrintersConfig = {
  printers: Partial<Record<"Parrilla" | "Freidora" | "Barra" | "Cocina" | "Caja", string>>;
  paperWidthMm?: 58 | 80;
  /** escpos: directo a la térmica (recomendado); windows: por el controlador, para impresoras de hoja */
  printMode?: "escpos" | "windows";
  /** Abrir el cajón de dinero (conectado a la impresora de Caja) al cobrar en efectivo */
  openDrawer?: boolean;
};

/** Le pasa al Agent qué impresora tiene cada estación (lo usa para el ticket original y el respaldo). */
export async function syncStationPrinters(config: StationPrintersConfig) {
  // En la nube el Agent la lee sola de la configuración sincronizada (bpos_agent_poll)
  if (isCloudConfigured) return { success: true };
  return callAgent<{ success?: boolean; error?: string }>("station-printers", config, "El Agent no guardó las impresoras.");
}

/** Imprime el ticket original de la plataforma en esas estaciones (force: reimpresión). */
export async function printOriginalTicket(input: { platform: string; orderId: string; stations: string[]; force?: boolean }) {
  return callAgent<{
    success?: boolean;
    error?: string;
    alreadyPrinted?: boolean;
    printers?: string[];
    stations?: string[];
    results?: { printer: string; ok: boolean; error?: string }[];
    missing?: string[];
  }>("print-original", input, "El Agent no pudo imprimir el ticket.");
}

/** Lo que guarda Configuración → Impresoras (bpos_station_printers) en el formato del Agent. */
export function toStationPrintersConfig(saved: Record<string, unknown>): StationPrintersConfig {
  const pick = (station: string) => (typeof saved?.[station] === "string" ? (saved[station] as string) : "");
  return {
    printers: { Parrilla: pick("Parrilla"), Freidora: pick("Freidora"), Barra: pick("Barra"), Cocina: pick("Cocina"), Caja: pick("Caja") },
    paperWidthMm: Number(saved?.paperWidthMm) === 58 ? 58 : 80,
    printMode: saved?.printMode === "windows" ? "windows" : "escpos",
    openDrawer: saved?.openDrawer !== false,
  };
}

/**
 * Abre el cajón de dinero en cuanto se abre el cobro con Efectivo (sin esperar
 * al ticket). Regresa true si el Agent lo abrió; false si no pudo o es un Agent
 * viejo sin este trabajo (entonces se abre con el ticket, como antes).
 */
export async function openCashDrawer(): Promise<boolean> {
  try {
    const r = await callAgent<{ success?: boolean; error?: string; opened?: boolean }>("open-drawer", {}, "No se pudo abrir el cajón.");
    return r.opened === true;
  } catch {
    return false;
  }
}

/** Tickets propios de un pedido de delivery: uno por estación y el de la bolsa (Caja). */
export async function printDeliveryTickets(input: {
  platform: string;
  orderId: string;
  tickets: { target: string; html: string }[];
  force?: boolean;
}) {
  return callAgent<{
    success?: boolean;
    error?: string;
    alreadyPrinted?: boolean;
    targets?: string[];
    results?: { target: string; printer?: string; ok: boolean; error?: string }[];
  }>("print-tickets", input, "El Agent no pudo imprimir los tickets.");
}
