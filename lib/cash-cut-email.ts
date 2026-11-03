"use client";
import { bridgeFetch } from "@/lib/bridge/bridge-fetch";
import { getBusinessSettings, getCutEmail } from "@/lib/business-settings";

/**
 * Manda el corte de caja por correo (app/api/caja/corte) al correo de
 * Configuración → Empresa → Corte de caja. Regresa el correo al que llegó, o
 * lanza con el motivo para avisar en pantalla.
 */
export async function emailCashCut(cut: { folio: string; message: string }, to = getCutEmail()): Promise<string> {
  if (!to) throw new Error("No hay correo configurado para el corte.");
  const response = await bridgeFetch("/api/caja/corte", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, folio: cut.folio, businessName: getBusinessSettings().businessName, message: cut.message }),
  });
  const data = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
  if (!response.ok || !data.success) throw new Error(data.error || "No se pudo mandar el correo.");
  return to;
}
