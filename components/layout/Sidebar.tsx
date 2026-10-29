"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNotificationSound } from "@/lib/notifications/useNotificationSound";
import { getCurrentUser, clearCurrentUser } from "@/lib/auth";
import { hasPermission, permissionForPath } from "@/lib/permissions";
import {
  getOperationsAlerts,
  markAllOperationsAlertsViewed,
  syncCriticalInventoryAlerts,
  syncDeliveryPendingAlert,
  syncLowStockAlert,
  OPERATIONS_ALERT_EVENT,
} from "@/lib/notifications/operationsCenter";
import { bridgeFetch } from "@/lib/bridge/bridge-fetch";
import { EquivalencePrompt, type PendingEquivalence } from "@/components/bridge/EquivalencePrompt";

const navItems = [
  { label: "Dashboard", href: "/", icon: "📊" },
  { label: "POS", href: "/pos", icon: "🛒" },
  { label: "B-POS Bridge", href: "/bridge", icon: "🌉" },
  { label: "Centro de Operaciones", href: "/centro-operaciones", icon: "🚨" },
  { label: "Caja", href: "/caja", icon: "💵" },
  { label: "Historial de cortes", href: "/caja/historial", icon: "🧾" },
  { label: "Cocina KDS", href: "/cocina", icon: "👨‍🍳" },
  { label: "Impresiones", href: "/impresiones", icon: "🖨️" },
  { label: "Inventario", href: "/inventario", icon: "📦" },
  { label: "Compras", href: "/compras", icon: "🛒" },
  { label: "Clientes", href: "/clientes", icon: "👥" },
  { label: "Reportes", href: "/reportes", icon: "📈" },
  { label: "App del dueño", href: "/dueno", icon: "📱" },
  { label: "Configuración", href: "/configuracion", icon: "⚙️" },
];

const ACK_KEY = "bpos_bridge_pending_ack";
const POLL_MS = 3000;

type PendingResponse = {
  success?: boolean;
  count?: number;
  signature?: string;
  pending?: PendingEquivalence[];
};

export function Sidebar() {
  const router = useRouter();
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingItems, setPendingItems] = useState<PendingEquivalence[]>([]);
  const [signature, setSignature] = useState("");
  const [acknowledgedSignature, setAcknowledgedSignature] = useState("");
  const [lowStockCount, setLowStockCount] = useState(0);
  const [criticalCount, setCriticalCount] = useState(0);
  const [criticalSignature, setCriticalSignature] = useState("");
  const [warningSignature, setWarningSignature] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  const currentUser = getCurrentUser();

  const refreshOperations = useCallback(async () => {
    try {
      syncCriticalInventoryAlerts();
      syncLowStockAlert();

      const response = await bridgeFetch("/api/bridge/pending", { cache: "no-store" });
      const payload = (await response.json()) as PendingResponse;
      if (response.ok && payload.success) {
        const nextCount = Number(payload.count ?? 0);
        const nextSignature = String(payload.signature ?? "");
        setPendingCount(nextCount);
        setPendingItems(Array.isArray(payload.pending) ? payload.pending : []);
        setSignature(nextSignature);
        if (nextSignature) localStorage.setItem("bpos_bridge_pending_signature", nextSignature);
        syncDeliveryPendingAlert(nextCount, nextSignature);
      }

      const alerts = getOperationsAlerts();
      const critical = alerts.filter((item) => item.priority === "critical" && item.status === "pending");
      const warnings = alerts.filter((item) => item.priority === "warning" && item.status !== "resolved");
      setCriticalCount(critical.length);
      setLowStockCount(warnings.length);
      setCriticalSignature(critical.map((item) => item.id).sort().join("|"));
      setWarningSignature(warnings.map((item) => item.id).sort().join("|"));
    } catch {
      // La navegación continúa disponible si una fuente temporalmente no responde.
    }
  }, []);

  useEffect(() => {
    setAcknowledgedSignature(localStorage.getItem(ACK_KEY) || "");
    void refreshOperations();
    const timer = window.setInterval(() => void refreshOperations(), POLL_MS);
    const refresh = () => void refreshOperations();
    window.addEventListener(OPERATIONS_ALERT_EVENT, refresh);
    window.addEventListener("bpos:inventory-alerts-updated", refresh);
    window.addEventListener("bpos:critical-errors-updated", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(OPERATIONS_ALERT_EVENT, refresh);
      window.removeEventListener("bpos:inventory-alerts-updated", refresh);
      window.removeEventListener("bpos:critical-errors-updated", refresh);
    };
  }, [refreshOperations]);

  const shouldSoundDelivery = pendingCount > 0 && Boolean(signature) && signature !== acknowledgedSignature;
  useNotificationSound({ active: shouldSoundDelivery, kind: "delivery-equivalences" });

  useEffect(() => {
    if (!warningSignature) return;
    const key = `bpos_warning_sound:${warningSignature}`;
    if (sessionStorage.getItem(key)) return;
    new Audio("/sounds/BPOS_Official_Inventory_Warning.wav").play().catch(() => {});
    sessionStorage.setItem(key, "1");
  }, [warningSignature]);

  useEffect(() => {
    if (!criticalSignature) return;
    const key = `bpos_critical_sound:${criticalSignature}`;
    if (sessionStorage.getItem(key)) return;
    new Audio("/sounds/BPOS_Official_Critical_Error.wav").play().catch(() => {});
    sessionStorage.setItem(key, "1");
  }, [criticalSignature]);

  function openOperationsCenter() {
    if (signature) {
      localStorage.setItem(ACK_KEY, signature);
      setAcknowledgedSignature(signature);
    }
    markAllOperationsAlertsViewed(currentUser?.name);
    router.push("/centro-operaciones");
  }

  const hasPending = pendingCount > 0;
  const hasCritical = criticalCount > 0;
  const hasWarning = lowStockCount > 0;

  const visualState = hasCritical ? "critical" : hasPending ? "delivery" : hasWarning ? "warning" : "normal";
  const badgeCount = hasCritical ? criticalCount : hasPending ? pendingCount : hasWarning ? lowStockCount : 0;

  const visibleItems = useMemo(
    () => navItems.filter((item) => {
      const permission = permissionForPath(item.href);
      return !permission || hasPermission(currentUser, permission);
    }),
    [currentUser]
  );

  return (
    <>
    {/* Celular / tablet: botón para abrir el menú */}
    <button
      type="button"
      onClick={() => setMobileOpen(true)}
      className="fixed right-3 top-3 z-40 rounded-2xl border border-zinc-700 bg-black/90 px-4 py-3 text-sm font-black text-white shadow-lg backdrop-blur lg:hidden"
      aria-label="Abrir menú"
    >
      ☰ Menú{badgeCount > 0 ? ` (${badgeCount})` : ""}
    </button>
    {mobileOpen && (
      <div className="fixed inset-0 z-40 bg-black/70 lg:hidden" onClick={() => setMobileOpen(false)} />
    )}
    <aside className={`bpos-scroll fixed left-0 top-0 z-50 h-screen w-72 overflow-y-auto border-r border-zinc-800 bg-zinc-950 p-4 lg:z-auto lg:block lg:w-64 ${mobileOpen ? "block" : "hidden"}`}>
      <button
        type="button"
        onClick={() => setMobileOpen(false)}
        className="mb-4 w-full rounded-2xl border border-zinc-800 bg-black py-2 text-sm font-black text-zinc-300 lg:hidden"
      >
        ✕ Cerrar menú
      </button>
      <button
        type="button"
        onClick={openOperationsCenter}
        className={`mb-8 w-full rounded-2xl border p-4 text-left transition-all ${
          visualState === "critical"
            ? "animate-pulse border-red-400 bg-red-500/25 shadow-[0_0_32px_rgba(239,68,68,0.65)]"
            : visualState === "delivery"
            ? "animate-pulse border-emerald-300 bg-emerald-500/25 shadow-[0_0_28px_rgba(52,211,153,0.55)]"
            : visualState === "warning"
            ? "border-yellow-300/70 bg-yellow-400/10 shadow-[0_0_16px_rgba(253,224,71,0.35)]"
            : "border-zinc-800 bg-black"
        }`}
        title="Abrir Centro de Operaciones"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500 font-black text-black">BP</div>
          {badgeCount > 0 && (
            <span className={`flex min-w-7 items-center justify-center rounded-full px-2 py-1 text-xs font-black text-black ${hasCritical ? "bg-red-400" : hasPending ? "bg-emerald-300" : "bg-yellow-300"}`}>
              {badgeCount}
            </span>
          )}
        </div>

        <p className={`mt-3 text-sm font-bold ${hasCritical ? "text-red-200" : hasPending ? "text-emerald-200" : hasWarning ? "text-yellow-200" : "text-orange-500"}`}>Burger Planet</p>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-black text-white">BPOS</h1>
          {hasWarning && <span className="h-3 w-3 rounded-full bg-yellow-300 shadow-[0_0_12px_rgba(253,224,71,1)]" title={`${lowStockCount} alerta(s) de inventario`} />}
          {hasCritical && <span className="h-3 w-3 animate-pulse rounded-full bg-red-500 shadow-[0_0_14px_rgba(239,68,68,1)]" title={`${criticalCount} error(es) crítico(s)`} />}
        </div>

        {hasCritical && <p className="mt-2 text-xs font-bold text-red-100">Error crítico · abrir para revisar</p>}
        {!hasCritical && hasPending && <p className="mt-2 text-xs font-bold text-emerald-100">Equivalencias por enlazar · abrir ahora</p>}
        {!hasCritical && !hasPending && hasWarning && <p className="mt-2 text-xs font-bold text-yellow-100">Insumos por reponer</p>}
      </button>

      <nav className="space-y-2">
        {visibleItems.map((item) => (
          <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className="block rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm font-bold text-zinc-200 hover:border-orange-500 hover:text-orange-500">
            <span className="mr-2">{item.icon}</span>{item.label}
          </Link>
        ))}
      </nav>

      <div className="mt-6 rounded-2xl border border-zinc-800 bg-black p-3">
        <p className="text-sm font-black">{currentUser?.name || "Usuario"}</p>
        <p className="text-xs text-zinc-500">{currentUser?.role || "Sin rol"}</p>
        <button onClick={() => { clearCurrentUser(); window.location.href = "/login"; }} className="mt-3 w-full rounded-xl border border-zinc-700 px-3 py-2 text-xs font-black">Cerrar sesión</button>
      </div>
    </aside>
    <EquivalencePrompt items={pendingItems} signature={signature} canEquivalate={hasPermission(currentUser, "bridge.aliases")} />
    </>
  );
}
