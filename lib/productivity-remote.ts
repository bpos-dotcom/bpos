"use client";
/**
 * Lo de Productividad que pasa por el servidor (app/api/productividad):
 * el folio del QR de la foto de evidencia y el correo del inventario ciego.
 */
import { bridgeFetch } from "@/lib/bridge/bridge-fetch";
import { getBusinessSettings, getCutEmail } from "@/lib/business-settings";
import { blindSummary, getProductivitySettings, type BlindCount } from "@/lib/productivity";

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
