import { PrintJob } from "@/lib/bridge/printManager";

const LOCAL_SERVICE_URL = "http://localhost:4850";

export async function checkLocalService() {
  try {
    const response = await fetch(LOCAL_SERVICE_URL, {
      method: "GET",
    });

    if (!response.ok) return false;

    const data = await response.json();

    return data?.status === "running";
  } catch {
    return false;
  }
}

export async function sendJobToLocalService(job: PrintJob) {
  const response = await fetch(`${LOCAL_SERVICE_URL}/print`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(job),
  });

  if (!response.ok) {
    throw new Error("No se pudo enviar la comanda al servicio local.");
  }

  return response.json();
}
export type StationPrintersConfig = {
  printers: Partial<Record<"Parrilla" | "Freidora" | "Barra" | "Cocina" | "Caja", string>>;
  paperWidthMm?: 58 | 80;
};

/** Le pasa al Agent qué impresora tiene cada estación (lo usa para el ticket original y el respaldo). */
export async function syncStationPrinters(config: StationPrintersConfig) {
  const response = await fetch(`${LOCAL_SERVICE_URL}/station-printers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!response.ok) throw new Error("El Agent no guardó las impresoras.");
  return response.json();
}

/** Imprime el ticket original de la plataforma en esas estaciones (force: reimpresión). */
export async function printOriginalTicket(input: { platform: string; orderId: string; stations: string[]; force?: boolean }) {
  const response = await fetch(`${LOCAL_SERVICE_URL}/print-original`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    alreadyPrinted?: boolean;
    printers?: string[];
    stations?: string[];
    results?: { printer: string; ok: boolean; error?: string }[];
    missing?: string[];
  };
  if (!response.ok || !payload.success) throw new Error(payload.error || "El Agent no pudo imprimir el ticket.");
  return payload;
}

/** Lo que guarda Configuración → Impresoras (bpos_station_printers) en el formato del Agent. */
export function toStationPrintersConfig(saved: Record<string, unknown>): StationPrintersConfig {
  const pick = (station: string) => (typeof saved?.[station] === "string" ? (saved[station] as string) : "");
  return {
    printers: { Parrilla: pick("Parrilla"), Freidora: pick("Freidora"), Barra: pick("Barra"), Cocina: pick("Cocina"), Caja: pick("Caja") },
    paperWidthMm: Number(saved?.paperWidthMm) === 58 ? 58 : 80,
  };
}

/** Tickets propios de un pedido de delivery: uno por estación y el de la bolsa (Caja). */
export async function printDeliveryTickets(input: {
  platform: string;
  orderId: string;
  tickets: { target: string; html: string }[];
  force?: boolean;
}) {
  const response = await fetch(`${LOCAL_SERVICE_URL}/print-tickets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    alreadyPrinted?: boolean;
    targets?: string[];
    results?: { target: string; printer?: string; ok: boolean; error?: string }[];
  };
  if (!response.ok || !payload.success) throw new Error(payload.error || "El Agent no pudo imprimir los tickets.");
  return payload;
}
