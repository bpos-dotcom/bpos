import { sendJobToLocalService } from "@/lib/localService";
import { KitchenStation } from "@/data/products";
import {
  buildStationTicket,
  groupPrintableItemsByStation,
  PrintableOrder,
} from "@/lib/bridge/printing";

export type PrintJobStatus = "Pendiente" | "Impreso" | "Error";

export type PrintJob = {
  id: number;
  createdAt: string;
  orderId: number;
  station: KitchenStation;
  printerName: string;
  content: string;
  status: PrintJobStatus;
  reprintOf?: number;
  reprintCount?: number;
};

const PRINT_JOBS_KEY = "bpos_print_jobs";

const STATION_PRINTERS_KEY = "bpos_station_printers";

function getConfiguredPrinter(station: KitchenStation) {
  if (typeof window === "undefined") {
    return station;
  }

  const saved = localStorage.getItem(STATION_PRINTERS_KEY);

  if (!saved) {
    return station;
  }

  try {
    const config = JSON.parse(saved);

    return config[station] || station;
  } catch {
    return station;
  }
}

export function getPrintJobs(): PrintJob[] {
  if (typeof window === "undefined") return [];

  const saved = localStorage.getItem(PRINT_JOBS_KEY);
  return saved ? JSON.parse(saved) : [];
}

export function savePrintJobs(jobs: PrintJob[]) {
  localStorage.setItem(PRINT_JOBS_KEY, JSON.stringify(jobs));
}

export function createPrintJobsForOrder(order: PrintableOrder) {
  const groupedItems = groupPrintableItemsByStation(order);
  const currentJobs = getPrintJobs();

  const newJobs: PrintJob[] = Object.keys(groupedItems).map((station) => {
    const kitchenStation = station as KitchenStation;

    return {
      id: Date.now() + Math.floor(Math.random() * 10000),
      createdAt: new Date().toISOString(),
      orderId: order.id,
      station: kitchenStation,
      printerName: getConfiguredPrinter(kitchenStation),
      content: buildStationTicket(order, kitchenStation),
      status: "Pendiente",
      reprintCount: 0,
    };
  });

  savePrintJobs([...currentJobs, ...newJobs]);

  return newJobs;
}

export function reprintJob(jobId: number) {
  const jobs = getPrintJobs();
  const originalJob = jobs.find((job) => job.id === jobId);

  if (!originalJob) {
    throw new Error("Trabajo de impresión no encontrado.");
  }

  const reprint: PrintJob = {
    ...originalJob,
    id: Date.now() + Math.floor(Math.random() * 10000),
    createdAt: new Date().toISOString(),
    status: "Pendiente",
    reprintOf: originalJob.id,
    reprintCount: (originalJob.reprintCount || 0) + 1,
    content: `${originalJob.content}

*** REIMPRESIÓN ***
`,
  };

  savePrintJobs([...jobs, reprint]);

  return reprint;
}

export function markPrintJobAsPrinted(jobId: number) {
  const jobs = getPrintJobs();

  const nextJobs = jobs.map((job) =>
    job.id === jobId ? { ...job, status: "Impreso" as PrintJobStatus } : job
  );

  savePrintJobs(nextJobs);
}

export async function sendPrintJobToLocalService(job: PrintJob) {
  return sendJobToLocalService(job);
}

export async function sendPendingPrintJobsToLocalService() {
  const jobs = getPrintJobs();
  const pendingJobs = jobs.filter((job) => job.status === "Pendiente");

  for (const job of pendingJobs) {
    await sendPrintJobToLocalService(job);
  }

  return pendingJobs.length;
}