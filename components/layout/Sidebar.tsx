"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAlertSettings, useAlertSound } from "@/lib/notifications/useAlert";
import { getCurrentUser, clearCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import {
  getOperationsAlerts,
  markAllOperationsAlertsViewed,
  syncCriticalInventoryAlerts,
  syncDeliveryPendingAlert,
  syncLowStockAlert,
  OPERATIONS_ALERT_EVENT,
} from "@/lib/notifications/operationsCenter";
import { bridgeFetch, bridgeVersion as fetchBridgeVersion } from "@/lib/bridge/bridge-fetch";
import { BridgeProcessor, bridgeProcessorActive } from "@/components/bridge/BridgeProcessor";
import { ProductivityAlarm, useProductivityState } from "@/components/productivity/ProductivityAlarm";
import { readCachedPlan } from "@/components/cloud/PlanGate";
import { planIncludes } from "@/lib/plans";
import { getBusinessSettings } from "@/lib/business-settings";
import { runDailyBackup } from "@/lib/cloud/backup";
import { flushDrawerSuspects } from "@/lib/cash-drawer";
import { flushCloudAudit } from "@/lib/cloud/audit-outbox";
import { EquivalencePrompt, type PendingEquivalence } from "@/components/bridge/EquivalencePrompt";
import { useOnlineOrdersWatch } from "@/lib/online-orders-watch";
import { usePendingReviews } from "@/lib/reviews";
import { syncAdvisorSnapshot } from "@/lib/advisor-sync";
import { UpdateNotice } from "@/components/layout/UpdateNotice";

import { currentTab, visibleNav } from "@/lib/nav";
import { openServices } from "@/lib/services";
import { useServicesState } from "@/lib/services-client";

const ACK_KEY = "bpos_bridge_pending_ack";
const PINNED_KEY = "bpos_sidebar_pinned"; // solo de este dispositivo
const AUTO_CLOSE_MS = 10_000;
// Pendientes del Bridge: cada 3 s (también minimizado, para que pite) se revisa solo la huella
// (unos bytes); los pendientes completos se bajan cuando cambia o cada 5 minutos
const POLL_MS = 3000;
const FULL_EVERY_MS = 5 * 60_000;
// Recordatorios, mensajes del turno e inventario ciego
const PRODUCTIVITY_ALERT = { color: "#8b5cf6", blink: true };

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
  // Menú lateral (a la izquierda): se contrae solo (solo íconos) y se abre encima al pasar el
  // cursor o tocar »; se vuelve a contraer al salir el cursor o tras 10 s sin
  // usarlo. "📌 Fijar abierto" lo deja abierto (se recuerda en este dispositivo).
  const [pinned, setPinned] = useState(false);
  // Pedidos del menú digital esperando que alguien los acepte
  const online = useOnlineOrdersWatch();
  const onlineWaiting = online.count;
  const reviewsPending = usePendingReviews();

  // Marca del negocio (Configuración → Sistema): nombre, logo y color
  const [brand, setBrand] = useState({ name: "", logo: "", color: "#f97316" });
  useEffect(() => {
    const sync = () => {
      const s = getBusinessSettings();
      setBrand({ name: s.businessName, logo: s.brandLogo, color: s.brandColor });
    };
    sync();
    window.addEventListener("bpos:business-settings-updated", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("bpos:business-settings-updated", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  // Cobros cerrados con el cajón abierto: se avisan si nadie los cobró ni mandó a espera en 3 minutos
  useEffect(() => {
    void flushDrawerSuspects();
    const timer = setInterval(() => void flushDrawerSuspects(), 60_000);
    return () => clearInterval(timer);
  }, []);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let saved = false;
    try {
      saved = localStorage.getItem(PINNED_KEY) === "1";
    } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect -- preferencia del navegador: solo después de montar
    setPinned(saved);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("sidebar-collapsed", !pinned);
  }, [pinned]);
  const stopTimer = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const scheduleClose = (ms = AUTO_CLOSE_MS) => {
    stopTimer();
    closeTimer.current = setTimeout(() => setOpen(false), ms);
  };
  useEffect(() => stopTimer, []);
  function openMenu() {
    if (pinned) return;
    setOpen(true);
    scheduleClose();
  }
  function setPinnedSaved(value: boolean) {
    setPinned(value);
    setOpen(false);
    stopTimer();
    try {
      localStorage.setItem(PINNED_KEY, value ? "1" : "0");
    } catch {}
  }
  // En celular el menú siempre se ve completo
  const slim = !pinned && !open && !mobileOpen;
  const floating = !pinned && open && !mobileOpen; // abierto encima del contenido

  const currentUser = getCurrentUser();

  const bridgeVersion = useRef("");
  const lastFullCheck = useRef(0);
  const checking = useRef(false);

  /** Solo lo de este equipo (alertas guardadas): sin consultar la nube. Es lo que corre con cada aviso de cambio. */
  const refreshLocal = useCallback(() => {
    const alerts = getOperationsAlerts();
    const critical = alerts.filter((item) => item.priority === "critical" && item.status === "pending");
    const warnings = alerts.filter((item) => item.priority === "warning" && item.status !== "resolved");
    setCriticalCount(critical.length);
    setLowStockCount(warnings.length);
    setCriticalSignature(critical.map((item) => item.id).sort().join("|"));
    setWarningSignature(warnings.map((item) => item.id).sort().join("|"));
  }, []);

  /** Revisión con la nube (Bridge): solo con el reloj, una a la vez */
  const refreshOperations = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    try {
      syncCriticalInventoryAlerts();
      syncLowStockAlert();

      // El aviso de equivalencias y la revisión del Bridge solo en el equipo que procesa los pedidos
      // (el principal, o quien tenga abierto el Bridge); nunca en cocina ni en planes sin delivery
      if (!planIncludes(readCachedPlan(), "delivery") || !bridgeProcessorActive(window.location.pathname)) {
        setPendingCount(0);
        setPendingItems([]);
        refreshLocal();
        return;
      }
      const version = await fetchBridgeVersion();
      // Sin huella (falló la consulta) no se baja todo en cada vuelta: como máximo cada 30 s
      const changed = version ? version !== bridgeVersion.current || Date.now() - lastFullCheck.current > FULL_EVERY_MS : Date.now() - lastFullCheck.current > 30_000;
      const response = changed ? await bridgeFetch("/api/bridge/pending", { cache: "no-store" }) : null;
      if (changed) lastFullCheck.current = Date.now();
      const payload = response ? ((await response.json()) as PendingResponse) : null;
      if (response && payload && response.ok && payload.success) {
        bridgeVersion.current = version;
        const nextCount = Number(payload.count ?? 0);
        const nextSignature = String(payload.signature ?? "");
        setPendingCount(nextCount);
        setPendingItems(Array.isArray(payload.pending) ? payload.pending : []);
        setSignature(nextSignature);
        if (nextSignature) localStorage.setItem("bpos_bridge_pending_signature", nextSignature);
        syncDeliveryPendingAlert(nextCount, nextSignature);
      }

      refreshLocal();
    } catch {
      // La navegación continúa disponible si una fuente temporalmente no responde.
    } finally {
      checking.current = false;
    }
  }, [refreshLocal]);

  useEffect(() => {
    setAcknowledgedSignature(localStorage.getItem(ACK_KEY) || "");
    void refreshOperations();
    // Respaldo automático del día (una vez; lo guarda la computadora de la caja)
    const backupTimer = window.setTimeout(() => void runDailyBackup(), 60_000);
    // Números del día para el resumen del Asesor por correo (una vez al día)
    const advisorTimer = window.setTimeout(() => void syncAdvisorSnapshot(), 120_000);
    // Bitácora pendiente de subir (ej. se hizo algo sin internet)
    const auditTimer = window.setInterval(() => void flushCloudAudit(), 60_000);
    void flushCloudAudit();
    const timer = window.setInterval(() => void refreshOperations(), POLL_MS);
    // Los avisos de cambio solo vuelven a leer lo local (antes disparaban otra revisión con la nube → ciclo)
    const refresh = () => refreshLocal();
    window.addEventListener(OPERATIONS_ALERT_EVENT, refresh);
    window.addEventListener("bpos:inventory-alerts-updated", refresh);
    window.addEventListener("bpos:critical-errors-updated", refresh);
    return () => {
      window.clearTimeout(backupTimer);
      window.clearTimeout(advisorTimer);
      window.clearInterval(auditTimer);
      window.clearInterval(timer);
      window.removeEventListener(OPERATIONS_ALERT_EVENT, refresh);
      window.removeEventListener("bpos:inventory-alerts-updated", refresh);
      window.removeEventListener("bpos:critical-errors-updated", refresh);
    };
  }, [refreshOperations, refreshLocal]);

  // Avisos con el sonido, veces y color de Configuración → Notificaciones
  const alerts = useAlertSettings();
  const shouldSoundDelivery = pendingCount > 0 && Boolean(signature) && signature !== acknowledgedSignature;
  useAlertSound("delivery-equivalences", alerts["delivery-equivalences"], shouldSoundDelivery, signature || "");
  useAlertSound("online-order", alerts["online-order"], onlineWaiting > 0, online.ids);
  useAlertSound("inventory-warning", alerts["inventory-warning"], Boolean(warningSignature), warningSignature);
  useAlertSound("critical-error", alerts["critical-error"], Boolean(criticalSignature), criticalSignature);

  const productivity = useProductivityState();

  function openOperationsCenter() {
    // Un pedido del menú en línea esperando va primero: se abre directo
    if (onlineWaiting > 0) {
      router.push("/pedidos-en-linea");
      return;
    }
    if (productivity.count > 0) {
      router.push("/productividad");
      return;
    }
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

  const hasOnline = onlineWaiting > 0;
  const hasProductivity = productivity.count > 0;
  // Color y parpadeo del aviso que se está mostrando
  const activeAlert = hasCritical ? alerts["critical-error"] : hasOnline ? alerts["online-order"] : hasProductivity ? PRODUCTIVITY_ALERT : hasPending ? alerts["delivery-equivalences"] : hasWarning ? alerts["inventory-warning"] : null;
  const alertStyle = activeAlert
    ? { borderColor: activeAlert.color, background: `${activeAlert.color}33`, boxShadow: `0 0 28px ${activeAlert.color}8c` }
    : undefined;
  const badgeCount = hasCritical ? criticalCount : hasOnline ? onlineWaiting : hasProductivity ? productivity.count : hasPending ? pendingCount : hasWarning ? lowStockCount : 0;

  // Secciones (algunas juntan varias pantallas en subpestañas); cada una lleva a la primera que puede abrir
  // Cuenta de solo servicios: el menú lleva solo sus servicios vigentes
  const services = useServicesState();
  const serviceIds = services?.kind === "servicios" ? openServices(services.services).join(",") : null;
  const visibleGroups = useMemo(() => visibleNav(currentUser, serviceIds === null ? null : (serviceIds.split(",").filter(Boolean) as Parameters<typeof visibleNav>[1])), [currentUser, serviceIds]);
  const pathname = usePathname();
  const activeGroup = currentTab(pathname || "", visibleGroups)?.group.label;

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
    <aside
      onMouseEnter={openMenu}
      onMouseLeave={() => !pinned && scheduleClose(300)}
      onPointerMove={() => floating && scheduleClose()}
      onScroll={() => floating && scheduleClose()}
      className={`bpos-scroll bpos-sidebar fixed left-0 top-0 z-50 h-screen w-72 overflow-y-auto overflow-x-hidden border-r border-zinc-800 bg-zinc-950 lg:block ${floating ? "is-open lg:z-50 shadow-[12px_0_40px_rgba(0,0,0,0.6)]" : "lg:z-auto"} ${slim ? "p-2" : "p-4"} ${mobileOpen ? "block" : "hidden"}`}
    >
      <button
        type="button"
        onClick={() => (pinned ? setPinnedSaved(false) : open ? setPinnedSaved(true) : openMenu())}
        className={`mb-3 hidden w-full items-center rounded-xl border border-zinc-800 bg-black py-2 text-xs font-black text-zinc-400 hover:border-orange-500 hover:text-orange-500 lg:flex ${slim ? "justify-center" : "justify-between px-3"}`}
        title={slim ? "Abrir menú" : pinned ? "Que se contraiga solo" : "Dejar el menú abierto"}
        aria-label={slim ? "Abrir menú" : pinned ? "Que se contraiga solo" : "Dejar el menú abierto"}
      >
        {slim ? "»" : pinned ? (
          <>
            <span>Contraer solo</span>
            <span>«</span>
          </>
        ) : (
          <>
            <span>📌 Fijar abierto</span>
            <span>«</span>
          </>
        )}
      </button>
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
        className={`w-full rounded-2xl border text-left transition-all ${slim ? "mb-4 p-2" : "mb-8 p-4"} ${activeAlert ? (activeAlert.blink ? "animate-pulse" : "") : "border-zinc-800 bg-black"}`}
        style={alertStyle}
        title="Abrir Centro de Operaciones"
      >
        <div className={`flex items-start gap-3 ${slim ? "relative justify-center" : "justify-between"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- logo del negocio (data URL) o el de B-POS */}
          <img src={brand.logo || "/bpos-logo.png"} alt={brand.name || "B-POS"} className={`shrink-0 rounded-lg object-contain ${slim ? "h-10 w-10" : "h-14 w-14"}`} />
          {badgeCount > 0 && (
            <span className={`flex min-w-7 items-center justify-center rounded-full px-2 py-1 text-xs font-black text-black ${slim ? "absolute -right-1 -top-1" : ""}`} style={{ background: activeAlert?.color || "#fde047" }}>
              {badgeCount}
            </span>
          )}
        </div>
        {!slim && (
        <>

        <div className="mt-3 flex items-center gap-2">
          <h1
            className="break-words text-xl font-black leading-tight"
            style={{ color: activeAlert ? "#ffffff" : brand.color }}
          >
            {brand.name}
          </h1>
          {hasWarning && <span className="h-3 w-3 rounded-full bg-yellow-300 shadow-[0_0_12px_rgba(253,224,71,1)]" title={`${lowStockCount} alerta(s) de inventario`} />}
          {hasCritical && <span className="h-3 w-3 animate-pulse rounded-full bg-red-500 shadow-[0_0_14px_rgba(239,68,68,1)]" title={`${criticalCount} error(es) crítico(s)`} />}
        </div>

        <p className="mt-1 text-[11px] font-semibold text-zinc-500">Operado por bpos.com.mx</p>

        {hasCritical && <p className="mt-2 text-xs font-bold text-white">Error crítico · abrir para revisar</p>}
        {!hasCritical && hasOnline && <p className="mt-2 text-xs font-bold text-white">🔔 Nuevo pedido del menú en línea · abrir ahora</p>}
        {!hasCritical && !hasOnline && hasProductivity && (
          <p className="mt-2 text-xs font-bold text-white">
            {productivity.messages.length ? "💬 Mensaje del turno" : productivity.blind ? "📦 Inventario ciego" : "⏰ Recordatorio pendiente"} · abrir ahora
          </p>
        )}
        {!hasCritical && !hasOnline && !hasProductivity && hasPending && <p className="mt-2 text-xs font-bold text-white">Equivalencias por enlazar · abrir ahora</p>}
        {!hasCritical && !hasPending && !hasOnline && hasWarning && <p className="mt-2 text-xs font-bold text-white">Insumos por reponer</p>}
        </>
        )}
      </button>

      <nav className="space-y-2">
        {visibleGroups.map((group) => {
          const has = (href: string) => group.tabs.some((t) => t.href === href);
          const onlineHere = has("/pedidos-en-linea") && onlineWaiting > 0;
          const active = group.label === activeGroup;
          return (
            <Link
              key={group.label}
              // Pedidos del menú esperando: el botón lleva directo a ellos aunque la primera pestaña sea otra
              href={onlineHere ? "/pedidos-en-linea" : group.tabs[0].href}
              onClick={() => setMobileOpen(false)}
              title={group.tabs.length > 1 ? `${group.label}: ${group.tabs.map((t) => t.label).join(" · ")}` : group.label}
              className={`relative block rounded-2xl border py-3 text-sm font-bold hover:border-orange-500 hover:text-orange-500 ${slim ? "text-center text-lg" : "px-4"} ${
                onlineHere ? "animate-pulse border-emerald-400 bg-emerald-500/20 text-emerald-100" : active ? "border-orange-500/70 bg-orange-500/10 text-orange-300" : "border-zinc-800 bg-zinc-900 text-zinc-200"
              }`}
            >
              {slim ? group.icon : (
                <>
                  <span className="mr-2">{group.icon}</span>
                  {group.label}
                </>
              )}
              {has("/opiniones") && reviewsPending > 0 && (
                <span className={`flex min-w-6 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-black text-white ${slim ? "absolute -right-1 -top-1" : "float-right"}`}>{reviewsPending}</span>
              )}
              {onlineHere && (
                <span className={`flex min-w-6 items-center justify-center rounded-full bg-emerald-400 px-1.5 text-xs font-black text-black ${slim ? "absolute -right-1 -top-1" : "float-right"}`}>{onlineWaiting}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {slim ? (
        <button
          onClick={() => { clearCurrentUser(); window.location.href = "/login"; }}
          title={`Cerrar sesión (${currentUser?.name || "Usuario"})`}
          className="mt-6 flex h-11 w-full items-center justify-center rounded-2xl border border-zinc-800 bg-black text-sm font-black text-zinc-300"
        >
          {(currentUser?.name || "U").slice(0, 1).toUpperCase()} ⏻
        </button>
      ) : (
        <div className="mt-6 rounded-2xl border border-zinc-800 bg-black p-3">
          <p className="text-sm font-black">{currentUser?.name || "Usuario"}</p>
          <p className="text-xs text-zinc-500">{currentUser?.role || "Sin rol"}</p>
          <button onClick={() => { clearCurrentUser(); window.location.href = "/login"; }} className="mt-3 w-full rounded-xl border border-zinc-700 px-3 py-2 text-xs font-black">Cerrar sesión</button>
        </div>
      )}
    </aside>
    <UpdateNotice />
    <BridgeProcessor />
    <ProductivityAlarm />
    <EquivalencePrompt items={pendingItems} signature={signature} canEquivalate={hasPermission(currentUser, "bridge.aliases")} />
    </>
  );
}
