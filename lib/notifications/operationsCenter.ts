"use client";
import type { CurrentUser } from "@/lib/auth";
import { getPendingLowStock } from "@/lib/inventory";
import { hasAlertPermission, type PermissionKey } from "@/lib/permissions";

/**
 * Qué permiso hace falta para ver cada aviso (Usuarios y seguridad → Avisos).
 * Un cajero no debe ver aumentos de costo ni avisos sobre el cajón.
 */
export function alertPermission(alert: Pick<OperationsAlert, "id" | "priority" | "source">): PermissionKey {
  const id = alert.id;
  if (id.startsWith("purchase-cost:") || id.startsWith("manual-cost:") || id.startsWith("cash:")) return "alerts.money";
  if (id.startsWith("drawer:")) return "alerts.security";
  if (alert.priority === "critical") return "alerts.critical";
  if (alert.priority === "delivery" || id.startsWith("bridge-") || /bridge/i.test(alert.source)) return "alerts.delivery";
  if (alert.source === "Inventario") return "alerts.inventory";
  // Lo que no tenga tipo conocido, solo quien ve los avisos de dinero (dueño y gerente)
  return "alerts.money";
}

/** Avisos que este usuario puede ver */
export function visibleAlerts(alerts: OperationsAlert[], user: Pick<CurrentUser, "id" | "role"> | null | undefined) {
  return alerts.filter((alert) => hasAlertPermission(user, alertPermission(alert)));
}

export type OperationsAlertPriority = "critical" | "delivery" | "warning" | "info";
export type OperationsAlertStatus = "pending" | "viewed" | "resolved";

export type OperationsAlert = {
  id: string;
  priority: OperationsAlertPriority;
  title: string;
  message: string;
  source: string;
  moduleHref?: string;
  status: OperationsAlertStatus;
  createdAt: string;
  viewedAt?: string;
  viewedBy?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNote?: string;
  metadata?: Record<string, unknown>;
};

const ALERTS_KEY = "bpos_operations_center_alerts";
const EVENT_NAME = "bpos:operations-alerts-updated";

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeAlerts(alerts: OperationsAlert[]) {
  localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts.slice(0, 500)));
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function getOperationsAlerts(): OperationsAlert[] {
  return readJson<OperationsAlert[]>(ALERTS_KEY, []).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function upsertOperationsAlert(
  alert: Omit<OperationsAlert, "createdAt" | "status"> &
    Partial<Pick<OperationsAlert, "createdAt" | "status">>
) {
  const alerts = getOperationsAlerts();
  const index = alerts.findIndex((item) => item.id === alert.id);
  const existing = index >= 0 ? alerts[index] : undefined;
  const next: OperationsAlert = {
    ...existing,
    ...alert,
    createdAt: alert.createdAt || existing?.createdAt || new Date().toISOString(),
    status: alert.status || existing?.status || "pending",
  };
  // Sin cambios no se vuelve a guardar: guardar avisa a las pantallas (que vuelven a revisar) y
  // sincroniza con la nube; repetirlo sin cambios hacía un ciclo de miles de consultas por hora
  if (existing && JSON.stringify(existing) === JSON.stringify(next)) return existing;
  if (index >= 0) alerts[index] = next;
  else alerts.unshift(next);
  writeAlerts(alerts);
  return next;
}

export function markOperationsAlertViewed(id: string, userName?: string) {
  const alerts = getOperationsAlerts();
  const next = alerts.map((item) =>
    item.id === id && item.status === "pending"
      ? {
          ...item,
          status: "viewed" as const,
          viewedAt: new Date().toISOString(),
          viewedBy: userName,
        }
      : item
  );
  writeAlerts(next);
}

export function markAllOperationsAlertsViewed(userName?: string) {
  const now = new Date().toISOString();
  writeAlerts(
    getOperationsAlerts().map((item) =>
      item.status === "pending"
        ? { ...item, status: "viewed", viewedAt: now, viewedBy: userName }
        : item
    )
  );
}

export function resolveOperationsAlert(id: string, userName?: string, note?: string) {
  const alerts = getOperationsAlerts();
  writeAlerts(
    alerts.map((item) =>
      item.id === id
        ? {
            ...item,
            status: "resolved" as const,
            resolvedAt: new Date().toISOString(),
            resolvedBy: userName,
            resolutionNote: note?.trim() || undefined,
          }
        : item
    )
  );
}

export function reopenOperationsAlert(id: string) {
  writeAlerts(
    getOperationsAlerts().map((item) =>
      item.id === id
        ? {
            ...item,
            status: "pending" as const,
            viewedAt: undefined,
            viewedBy: undefined,
            resolvedAt: undefined,
            resolvedBy: undefined,
            resolutionNote: undefined,
          }
        : item
    )
  );
}

export function syncCriticalInventoryAlerts() {
  const legacy = readJson<Array<Record<string, unknown>>>("bpos_critical_errors", []);
  legacy.forEach((item) => {
    const id = String(item.id || `critical-${String(item.createdAt || Date.now())}`);
    const operationsId = `legacy:${id}`;
    const existing = getOperationsAlerts().find((alert) => alert.id === operationsId);
    const status: OperationsAlertStatus = item.resolved
      ? "resolved"
      : existing?.status || (item.acknowledged ? "viewed" : "pending");
    upsertOperationsAlert({
      id: operationsId,
      priority: "critical",
      title: "Error crítico",
      message: String(item.message || "B-POS detectó un error que requiere atención."),
      source: "Inventario / Sistema",
      moduleHref: "/inventario",
      status,
      createdAt: String(item.createdAt || new Date().toISOString()),
      metadata: item,
    });
  });
}

export function syncLowStockAlert() {
  // Solo lo que sigue por debajo de su mínimo (lo ya comprado sale)
  const ids = getPendingLowStock().map((i) => i.id);
  const alertId = "inventory:low-stock-current-shift";
  if (ids.length > 0) {
    upsertOperationsAlert({
      id: alertId,
      priority: "warning",
      title: "Insumos por reponer",
      message: `${ids.length} insumo(s) llegaron al mínimo o quedaron por debajo.`,
      source: "Inventario",
      moduleHref: "/inventario",
      metadata: { ingredientIds: ids },
    });
  } else {
    const existing = getOperationsAlerts().find((item) => item.id === alertId);
    if (existing && existing.status !== "resolved") {
      resolveOperationsAlert(alertId, "Sistema", "Ya no hay insumos por debajo de su mínimo.");
    }
  }
}

export function syncDeliveryPendingAlert(count: number, signature: string) {
  const activeId = signature ? `delivery:${signature}` : "delivery:pending";
  const alerts = getOperationsAlerts();
  for (const alert of alerts) {
    if (
      alert.priority === "delivery" &&
      alert.id !== activeId &&
      alert.status !== "resolved"
    ) {
      resolveOperationsAlert(alert.id, "Sistema", "Las equivalencias de ese grupo ya fueron atendidas.");
    }
  }
  if (count > 0) {
    upsertOperationsAlert({
      id: activeId,
      priority: "delivery",
      title: "Equivalencias pendientes",
      message: `${count} línea(s) de delivery requieren vinculación.`,
      source: "B-POS Bridge",
      moduleHref: "/bridge#bridge-aliases",
      metadata: { count, signature },
    });
  }
}

export const OPERATIONS_ALERT_EVENT = EVENT_NAME;
