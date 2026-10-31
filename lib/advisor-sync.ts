"use client";
/**
 * Resumen del Asesor por correo: una vez al día B-POS sube los números del
 * negocio (todas las sucursales) para que el lunes el servidor arme el
 * análisis aunque nadie abra la App del dueño. Solo lo hacen usuarios que
 * pueden ver la App del dueño, y el servidor solo lo guarda si el resumen
 * por correo está activado.
 */
import { aiFetch } from "@/lib/ai/client";
import { buildMetrics, today } from "@/lib/advisor-metrics";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { loadCloudOrders } from "@/lib/reports";

const DONE_KEY = "asesor:subida";

export async function syncAdvisorSnapshot(force = false) {
  try {
    if (!force && localStorage.getItem(DONE_KEY) === today()) return;
    if (!hasPermission(getCurrentUser(), "owner.view")) return;
    const cloud = await loadCloudOrders(new Date(Date.now() - 35 * 24 * 60 * 60 * 1000));
    if (!cloud) return;
    const metrics = buildMetrics(
      cloud.orders.map((o) => o.order),
      cloud.branches.length > 1 ? "Todas las sucursales" : cloud.branches[0]?.name || "Tu negocio"
    );
    const r = await aiFetch("/api/ai/asesor", { method: "POST", body: JSON.stringify({ action: "datos", metrics }) });
    if (r.ok) localStorage.setItem(DONE_KEY, today());
  } catch {
    // sin internet o sin sesión: se intenta otro día
  }
}
