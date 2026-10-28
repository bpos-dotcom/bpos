"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { getCurrentUser } from "@/lib/auth";
import { acknowledgeCriticalErrors } from "@/lib/inventory";
import {
  getOperationsAlerts,
  markAllOperationsAlertsViewed,
  markOperationsAlertViewed,
  reopenOperationsAlert,
  resolveOperationsAlert,
  syncCriticalInventoryAlerts,
  syncDeliveryPendingAlert,
  syncLowStockAlert,
  type OperationsAlert,
  type OperationsAlertPriority,
  type OperationsAlertStatus,
  OPERATIONS_ALERT_EVENT,
} from "@/lib/notifications/operationsCenter";
import { bridgeFetch } from "@/lib/bridge/bridge-fetch";

const tabs: Array<{ value: OperationsAlertStatus | "all"; label: string }> = [
  { value: "pending", label: "Pendientes" },
  { value: "viewed", label: "Vistas" },
  { value: "resolved", label: "Resueltas" },
  { value: "all", label: "Historial" },
];

const priorityMeta: Record<OperationsAlertPriority, { label: string; icon: string; classes: string }> = {
  critical: { label: "Crítica", icon: "🔴", classes: "border-red-500/50 bg-red-500/10 text-red-200" },
  delivery: { label: "Delivery", icon: "🟢", classes: "border-emerald-500/50 bg-emerald-500/10 text-emerald-200" },
  warning: { label: "Advertencia", icon: "🟡", classes: "border-yellow-400/50 bg-yellow-400/10 text-yellow-100" },
  info: { label: "Información", icon: "🔵", classes: "border-sky-400/50 bg-sky-400/10 text-sky-100" },
};

export default function OperationsCenterPage() {
  const [alerts, setAlerts] = useState<OperationsAlert[]>([]);
  const [tab, setTab] = useState<OperationsAlertStatus | "all">("pending");
  const [priority, setPriority] = useState<OperationsAlertPriority | "all">("all");
  const [query, setQuery] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});
  const user = getCurrentUser();

  const refresh = useCallback(async () => {
    syncCriticalInventoryAlerts();
    syncLowStockAlert();
    try {
      const response = await bridgeFetch("/api/bridge/pending", { cache: "no-store" });
      const payload = await response.json();
      if (response.ok && payload?.success) {
        syncDeliveryPendingAlert(Number(payload.count || 0), String(payload.signature || ""));
      }
    } catch {
      // El Centro sigue disponible aunque Bridge esté temporalmente inaccesible.
    }
    setAlerts(getOperationsAlerts());
  }, []);

  useEffect(() => {
    const openCenter = async () => {
      await refresh();
      acknowledgeCriticalErrors();
      markAllOperationsAlertsViewed(user?.name);
      localStorage.setItem("bpos_bridge_pending_ack", localStorage.getItem("bpos_bridge_pending_signature") || "");
      setAlerts(getOperationsAlerts());
    };
    void openCenter();
    const timer = window.setInterval(() => void refresh(), 3000);
    const onUpdate = () => setAlerts(getOperationsAlerts());
    window.addEventListener(OPERATIONS_ALERT_EVENT, onUpdate);
    window.addEventListener("bpos:inventory-alerts-updated", onUpdate);
    window.addEventListener("bpos:critical-errors-updated", onUpdate);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(OPERATIONS_ALERT_EVENT, onUpdate);
      window.removeEventListener("bpos:inventory-alerts-updated", onUpdate);
      window.removeEventListener("bpos:critical-errors-updated", onUpdate);
    };
  }, [refresh, user?.name]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return alerts.filter((alert) => {
      const matchesTab = tab === "all" || alert.status === tab;
      const matchesPriority = priority === "all" || alert.priority === priority;
      const matchesQuery = !term || `${alert.title} ${alert.message} ${alert.source}`.toLowerCase().includes(term);
      return matchesTab && matchesPriority && matchesQuery;
    });
  }, [alerts, tab, priority, query]);

  const counts = useMemo(() => ({
    pending: alerts.filter((item) => item.status === "pending").length,
    viewed: alerts.filter((item) => item.status === "viewed").length,
    resolved: alerts.filter((item) => item.status === "resolved").length,
    all: alerts.length,
  }), [alerts]);

  function canResolveManually(alert: OperationsAlert) {
    return alert.priority === "critical" || alert.priority === "info";
  }

  return (
    <AppShell title="Centro de Operaciones" subtitle="Alertas, incidencias y seguimiento operativo de B-POS.">
      <div className="mb-6 grid gap-3 md:grid-cols-4">
        {tabs.map((item) => (
          <button key={item.value} onClick={() => setTab(item.value)} className={`rounded-2xl border px-4 py-4 text-left transition ${tab === item.value ? "border-orange-500 bg-orange-500/10" : "border-zinc-800 bg-zinc-950 hover:border-zinc-600"}`}>
            <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">{item.label}</p>
            <p className="mt-1 text-3xl font-black text-white">{counts[item.value]}</p>
          </button>
        ))}
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-[2fr_1fr_auto]">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar alerta, módulo o detalle" className="rounded-2xl border border-zinc-800 bg-black px-4 py-3" />
        <select value={priority} onChange={(event) => setPriority(event.target.value as OperationsAlertPriority | "all")} className="rounded-2xl border border-zinc-800 bg-black px-4 py-3">
          <option value="all">Todas las prioridades</option>
          <option value="critical">Críticas</option>
          <option value="delivery">Delivery</option>
          <option value="warning">Advertencias</option>
          <option value="info">Informativas</option>
        </select>
        <button onClick={() => void refresh()} className="rounded-2xl bg-orange-500 px-5 py-3 font-black text-black">Actualizar</button>
      </div>

      <div className="space-y-4">
        {filtered.map((alert) => {
          const meta = priorityMeta[alert.priority];
          return (
            <article key={alert.id} className={`rounded-3xl border p-5 ${meta.classes}`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xl">{meta.icon}</span>
                    <h2 className="text-xl font-black text-white">{alert.title}</h2>
                    <span className="rounded-full border border-current/30 px-2 py-1 text-[11px] font-black uppercase">{meta.label}</span>
                    <span className="rounded-full bg-black/30 px-2 py-1 text-[11px] font-bold uppercase">{alert.status}</span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-zinc-200">{alert.message}</p>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-400">
                    <span>Origen: {alert.source}</span>
                    <span>{new Date(alert.createdAt).toLocaleString()}</span>
                    {alert.viewedBy && <span>Vista por: {alert.viewedBy}</span>}
                    {alert.resolvedBy && <span>Resuelta por: {alert.resolvedBy}</span>}
                  </div>
                  {alert.resolutionNote && <p className="mt-2 rounded-xl bg-black/25 px-3 py-2 text-xs text-zinc-300">Resolución: {alert.resolutionNote}</p>}
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                {alert.moduleHref && <Link href={alert.moduleHref} className="rounded-xl bg-white px-4 py-2 text-sm font-black text-black">Ir al módulo</Link>}
                {alert.status === "pending" && <button onClick={() => { markOperationsAlertViewed(alert.id, user?.name); setAlerts(getOperationsAlerts()); }} className="rounded-xl border border-zinc-500 px-4 py-2 text-sm font-black text-white">Marcar vista</button>}
                {canResolveManually(alert) && alert.status !== "resolved" && (
                  <>
                    <input value={resolutionNotes[alert.id] || ""} onChange={(event) => setResolutionNotes((current) => ({ ...current, [alert.id]: event.target.value }))} placeholder="Nota de resolución (opcional)" className="min-w-64 flex-1 rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm text-white" />
                    <button onClick={() => { resolveOperationsAlert(alert.id, user?.name, resolutionNotes[alert.id]); setAlerts(getOperationsAlerts()); }} className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-black text-black">Resolver</button>
                  </>
                )}
                {alert.status === "resolved" && <button onClick={() => { reopenOperationsAlert(alert.id); setAlerts(getOperationsAlerts()); }} className="rounded-xl border border-orange-500 px-4 py-2 text-sm font-black text-orange-300">Reabrir</button>}
              </div>

              {alert.priority === "warning" && alert.status !== "resolved" && <p className="mt-4 text-xs font-bold text-yellow-200">Esta alerta se resuelve desde Inventario al completar el flujo de lista de compras y cierre de turno.</p>}
              {alert.priority === "delivery" && alert.status !== "resolved" && <p className="mt-4 text-xs font-bold text-emerald-200">Esta alerta se resuelve al completar las equivalencias pendientes en Bridge.</p>}
            </article>
          );
        })}
        {filtered.length === 0 && <div className="rounded-3xl border border-dashed border-zinc-800 p-12 text-center text-zinc-500">No hay alertas para estos filtros.</div>}
      </div>
    </AppShell>
  );
}
