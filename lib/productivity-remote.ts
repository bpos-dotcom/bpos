"use client";
/**
 * Lo de Productividad que pasa por el servidor (app/api/productividad):
 * el folio del QR de la foto de evidencia, el QR de una lista de tareas
 * (cada quien la hace en su celular) y el correo del inventario ciego.
 */
import { bridgeFetch } from "@/lib/bridge/bridge-fetch";
import { getBusinessSettings, getCutEmail } from "@/lib/business-settings";
import {
  blindSummary,
  getLog,
  getProductivitySettings,
  itemNeedsPhoto,
  mergeRemoteList,
  setListToken,
  type BlindCount,
  type PendingTask,
  type RemoteListItem,
} from "@/lib/productivity";

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await bridgeFetch(url, init);
  const data = (await response.json().catch(() => ({}))) as T & { success?: boolean; error?: string };
  if (!response.ok || !data.success) throw new Error(data.error || "No se pudo conectar con B-POS.");
  return data;
}

/** Folio para el QR: el celular abre /evidencia/<token> y sube ahí la foto */
export async function newEvidenceToken(title: string) {
  const { token } = await call<{ token: string }>("/api/productividad", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accion: "evidencia", title }),
  });
  return token;
}

/** La foto que subieron con ese folio ("" si todavía no) */
export async function evidencePhoto(token: string) {
  const { photo } = await call<{ photo: string | null }>(`/api/productividad?token=${encodeURIComponent(token)}`, { cache: "no-store" });
  return photo || "";
}

// ------------------------------------------------------------ lista en los celulares

const LIST_TOKEN_MS = 12 * 60 * 60 * 1000;

/** El folio del QR de la lista: el que ya tiene (si no ha vencido) o uno nuevo con lo que llevan en la caja */
export async function listToken(p: PendingTask) {
  const record = getLog().find((r) => r.id === p.key) || p.record;
  if (record?.token && Date.now() - Date.parse(record.tokenAt || "") < LIST_TOKEN_MS - 60_000) return record.token;
  const items = (p.task.items || []).map((name) => ({
    name,
    photo: itemNeedsPhoto(p.task, name),
    url: record?.photos?.[name] || null,
    done: Boolean(record?.checked?.includes(name)),
    by: record?.itemBy?.[name]?.by || null,
    at: record?.itemBy?.[name]?.at || null,
  }));
  const { token } = await call<{ token: string }>("/api/productividad", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accion: "lista", title: p.task.title, items }),
  });
  setListToken(p, token);
  return token;
}

/**
 * Lee lo que llevan en los celulares y lo pasa a la caja (termina la lista
 * si ya están todas). Un folio vencido se olvida: el siguiente QR sale nuevo.
 */
export async function syncRemoteList(p: PendingTask) {
  const token = (getLog().find((r) => r.id === p.key) || p.record)?.token;
  if (!token) return;
  try {
    const { items } = await call<{ items: RemoteListItem[] | null }>(`/api/productividad?token=${encodeURIComponent(token)}`, { cache: "no-store" });
    if (Array.isArray(items)) mergeRemoteList(p, items);
  } catch (e) {
    if (e instanceof Error && /vencid|no encontrado/i.test(e.message)) setListToken(p, null);
  }
}

/** Lo que palomean en la caja también se ve en los celulares */
export async function pushListItem(p: PendingTask, item: string, done: boolean, by: string, url?: string) {
  const token = (getLog().find((r) => r.id === p.key) || p.record)?.token;
  const index = (p.task.items || []).indexOf(item);
  if (!token || index < 0) return;
  await call("/api/productividad", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accion: "lista-marcar", token, item: index, done, by, url }),
  }).catch(() => {});
}

/** A dónde llega el reporte del inventario ciego */
export function blindEmail() {
  const configured = getProductivitySettings().email.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configured)) return configured;
  const fallback = getCutEmail() || getBusinessSettings().businessEmail || "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fallback) ? fallback : "";
}

/** Manda el reporte del inventario ciego; regresa el correo o lanza con el motivo */
export async function emailBlindReport(count: BlindCount) {
  const to = blindEmail();
  if (!to) throw new Error("No hay correo para el reporte. Ponlo en la App del dueño → Productividad.");
  const s = blindSummary(count);
  await call("/api/productividad", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accion: "inventario-ciego",
      to,
      businessName: getBusinessSettings().businessName,
      when: new Date(count.submittedAt || count.slot).toLocaleString("es-MX", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }),
      by: count.submittedBy || count.startedBy || "",
      faltante: s.faltante,
      sobrante: s.sobrante,
      rows: s.rows.map((r) => ({ name: r.name, unit: r.unit, counted: r.counted, expected: r.expected, diff: r.diff, money: r.money, state: r.state })),
    }),
  });
  return to;
}
