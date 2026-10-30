/**
 * Todo lo que las pantallas le piden a B-POS Agent (imprimir, guardar qué
 * impresora tiene cada estación).
 *   En la nube (B-POS 2.0): por la cola de trabajos (lib/agent/client.ts),
 *   desde cualquier dispositivo del negocio.
 *   Sin nube (pruebas locales): directo al Agent de esta computadora.
 */
import { runAgentJob, type AgentJobKind } from "@/lib/agent/client";
import type { PrintJob } from "@/lib/bridge/printManager";
import { isCloudConfigured } from "@/lib/supabase/client";

const LOCAL_SERVICE_URL = "http://localhost:4850";

const LOCAL_PATHS: Record<AgentJobKind, string> = {
  print: "/print",
  "station-printers": "/station-printers",
  "print-original": "/print-original",
  "print-tickets": "/print-tickets",
};

/** Respuesta del Agent; con error si no lo pudo hacer. */
async function callAgent<T extends { success?: boolean; error?: string }>(kind: AgentJobKind, body: unknown, fallbackError: string): Promise<T> {
  if (isCloudConfigured) {
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
  };
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
