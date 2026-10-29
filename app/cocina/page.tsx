"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { SavedOrder } from "@/components/OrderHistoryPanel";
import { KitchenStation } from "@/data/products";
import { KDS_ORDERS_KEY, KdsStatus } from "@/lib/kds";
import {
  DEFAULT_KDS_STATIONS,
  KdsStationConfig,
  readKdsStationConfig,
  saveKdsStationConfig,
} from "@/lib/kds-config";
import type { KdsTicketLine } from "@/lib/bridge/ticket-structure";
import { isCancelled } from "@/lib/sale-cancel";

type KdsItem = SavedOrder["items"][number] & {
  externalName?: string;
};

type KdsOrder = Omit<SavedOrder, "items"> & {
  items: KdsItem[];
  localOrderNumber?: number;
  shiftSessionId?: string;
  status?: KdsStatus;
  kdsCompleted?: boolean;
  kdsCompletedAt?: string;
  kdsReleased?: boolean;
  kdsReleasedAt?: string;
  source?: string;
  externalOrderNumber?: string;
  externalPlatform?: string;
  externalRawText?: string;
  kdsTicketLines?: KdsTicketLine[];
  bridgeActions?: {
    inventoryAdjustments?: Array<{
      name?: string;
      quantity?: number;
      unit?: string;
      externalName?: string;
      sourceType?: string;
    }>;
    ignoredLines?: Array<{
      externalName?: string;
      quantity?: number;
    }>;
  };
};

const activeColumns: KdsStatus[] = ["Nuevo", "En preparación", "Listo"];
const baseStations: KitchenStation[] = ["Parrilla", "Freidora", "Barra", "Cocina"];

const stationIcons: Record<KitchenStation, string> = {
  Parrilla: "🔥",
  Freidora: "🍟",
  Barra: "🥤",
  Cocina: "👨‍🍳",
};

function platformLabel(value?: string) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("didi")) return "DiDi Food";
  if (normalized.includes("uber")) return "Uber Eats";
  if (normalized.includes("rappi")) return "Rappi";
  return "Plataforma";
}

function playStationNotification() {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(720, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(980, context.currentTime + 0.18);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.32, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.26);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.28);
    window.setTimeout(() => void context.close(), 500);
  } catch {
    // El navegador puede bloquear audio hasta la primera interacción.
  }
}

export default function CocinaPage() {
  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [stationConfig, setStationConfig] = useState<KdsStationConfig[]>(
    DEFAULT_KDS_STATIONS
  );
  const [stationFilter, setStationFilter] = useState<"Todas" | KitchenStation>(
    "Todas"
  );
  const [showHistory, setShowHistory] = useState(false);
  const [showStationSettings, setShowStationSettings] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set());
  const previousVisibleOrderIds = useRef<Set<number>>(new Set());
  const initialLoadDone = useRef(false);

  const enabledStations = useMemo(
    () => stationConfig.filter((station) => station.enabled),
    [stationConfig]
  );

  const stationName = useCallback(
    (station: KitchenStation) =>
      stationConfig.find((item) => item.id === station)?.name || station,
    [stationConfig]
  );

  const loadOrders = useCallback(() => {
    try {
      const raw = localStorage.getItem(KDS_ORDERS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      setOrders(Array.isArray(parsed) ? parsed : []);
    } catch {
      setOrders([]);
    }
  }, []);

  useEffect(() => {
    const config = readKdsStationConfig();
    setStationConfig(config);

    const params = new URLSearchParams(window.location.search);
    const requestedStation = params.get("station");
    const requestedFullscreen = params.get("fullscreen") === "1";
    setFullscreen(requestedFullscreen);

    const matching = config.find(
      (item) =>
        item.enabled &&
        (item.id.toLowerCase() === String(requestedStation || "").toLowerCase() ||
          item.name.toLowerCase() === String(requestedStation || "").toLowerCase())
    );

    if (matching) setStationFilter(matching.id);
    else if (config.filter((item) => item.enabled).length === 1) {
      setStationFilter(config.find((item) => item.enabled)?.id || "Todas");
    }

    loadOrders();

    const refresh = () => loadOrders();
    const configRefresh = () => setStationConfig(readKdsStationConfig());
    const storageRefresh = (event: StorageEvent) => {
      if (!event.key || event.key === KDS_ORDERS_KEY) loadOrders();
      if (!event.key || event.key === "bpos_kds_station_config") configRefresh();
    };

    window.addEventListener("bpos:orders-updated", refresh);
    window.addEventListener("bpos:kds-updated", refresh);
    window.addEventListener("bpos:kds-config-updated", configRefresh);
    window.addEventListener("storage", storageRefresh);

    const timer = window.setInterval(() => {
      setNow(new Date());
      loadOrders();
    }, 1000);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("bpos:orders-updated", refresh);
      window.removeEventListener("bpos:kds-updated", refresh);
      window.removeEventListener("bpos:kds-config-updated", configRefresh);
      window.removeEventListener("storage", storageRefresh);
    };
  }, [loadOrders]);

  function saveOrders(nextOrders: KdsOrder[]) {
    setOrders(nextOrders);
    localStorage.setItem(KDS_ORDERS_KEY, JSON.stringify(nextOrders));
    window.dispatchEvent(new Event("bpos:kds-updated"));
  }

  function updateStatus(id: number, status: KdsStatus) {
    saveOrders(
      orders.map((order) =>
        order.id === id
          ? {
              ...order,
              status,
              ...(status === "En preparación" && !order.kdsReleasedAt
                ? { kdsReleasedAt: new Date().toISOString() }
                : {}),
            }
          : order
      )
    );
  }

  function deliverOrder(id: number) {
    saveOrders(
      orders.map((order) =>
        order.id === id
          ? {
              ...order,
              status: "Entregado",
              kdsCompleted: true,
              kdsCompletedAt: new Date().toISOString(),
            }
          : order
      )
    );
  }

  function getElapsedSeconds(createdAt: string) {
    return Math.max(
      0,
      Math.floor((now.getTime() - new Date(createdAt).getTime()) / 1000)
    );
  }

  function getElapsedTime(createdAt: string) {
    const seconds = getElapsedSeconds(createdAt);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${remainingSeconds
      .toString()
      .padStart(2, "0")}`;
  }

  function getTimeColor(createdAt: string) {
    const minutes = Math.floor(getElapsedSeconds(createdAt) / 60);
    if (minutes >= 15) return "text-red-200 border-red-500 bg-red-500/20";
    if (minutes >= 10) return "text-orange-200 border-orange-500 bg-orange-500/20";
    if (minutes >= 5) return "text-yellow-200 border-yellow-500 bg-yellow-500/15";
    return "text-green-300 border-green-500/50 bg-green-500/10";
  }

  function groupItemsByStation(order: KdsOrder) {
    return order.items.reduce((acc, item) => {
      const station = (item.station || "Cocina") as KitchenStation;
      if (!acc[station]) acc[station] = [];
      acc[station].push(item);
      return acc;
    }, {} as Record<KitchenStation, KdsItem[]>);
  }

  const activeOrders = useMemo(
    () =>
      orders
        .filter((order) => {
          if (order.kdsCompleted || order.status === "Entregado" || isCancelled(order)) return false;
          if (order.source === "B-POS Bridge" && order.kdsReleased !== true)
            return false;
          if (stationFilter === "Todas") {
            return order.items.some((item) =>
              enabledStations.some(
                (station) => station.id === (item.station || "Cocina")
              )
            );
          }
          return order.items.some(
            (item) => (item.station || "Cocina") === stationFilter
          );
        })
        .sort(
          (a, b) =>
            getElapsedSeconds(b.createdAt) - getElapsedSeconds(a.createdAt)
        ),
    [orders, stationFilter, enabledStations, now]
  );

  useEffect(() => {
    const currentIds = new Set(activeOrders.map((order) => order.id));
    if (initialLoadDone.current) {
      const hasNew = activeOrders.some(
        (order) => !previousVisibleOrderIds.current.has(order.id)
      );
      if (hasNew) playStationNotification();
    } else {
      initialLoadDone.current = true;
    }
    previousVisibleOrderIds.current = currentIds;
  }, [activeOrders]);

  const completedOrders = useMemo(
    () =>
      orders
        .filter((order) => order.kdsCompleted || order.status === "Entregado")
        .filter((order) => {
          if (stationFilter === "Todas") return true;
          return order.items.some(
            (item) => (item.station || "Cocina") === stationFilter
          );
        })
        .slice()
        .reverse(),
    [orders, stationFilter]
  );

  const ordersByStatus = useMemo(
    () =>
      activeColumns.reduce((acc, status) => {
        acc[status] = activeOrders.filter(
          (order) => (order.status || "Nuevo") === status
        );
        return acc;
      }, {} as Record<KdsStatus, KdsOrder[]>),
    [activeOrders]
  );

  function toggleOrder(id: number) {
    setExpandedOrders((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function updateStationConfig(
    id: KitchenStation,
    change: Partial<KdsStationConfig>
  ) {
    setStationConfig((current) =>
      current.map((station) =>
        station.id === id ? { ...station, ...change } : station
      )
    );
  }

  function persistStationConfig() {
    const enabledCount = stationConfig.filter((station) => station.enabled).length;
    if (enabledCount === 0) {
      window.alert("Activa por lo menos una estación KDS.");
      return;
    }
    saveKdsStationConfig(stationConfig);
    if (
      stationFilter !== "Todas" &&
      !stationConfig.find((item) => item.id === stationFilter)?.enabled
    ) {
      setStationFilter("Todas");
    }
    setShowStationSettings(false);
  }

  function stationUrl(station: KitchenStation, useFullscreen = true) {
    const url = new URL(window.location.href);
    url.pathname = "/cocina";
    url.search = "";
    url.searchParams.set("station", station);
    if (useFullscreen) url.searchParams.set("fullscreen", "1");
    return url.toString();
  }

  function renderOrder(order: KdsOrder, status: KdsStatus) {
    const groupedItems = groupItemsByStation(order);
    const external = order.source === "B-POS Bridge";
    const adjustments = order.bridgeActions?.inventoryAdjustments || [];
    const expanded = expandedOrders.has(order.id);
    const visibleItems = order.items.filter(
      (item) =>
        stationFilter === "Todas" ||
        (item.station || "Cocina") === stationFilter
    );
    const productCount = visibleItems.reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0
    );

    return (
      <article
        key={order.id}
        className="rounded-3xl border border-zinc-700 bg-black p-4 shadow-xl"
      >
        <button
          type="button"
          onClick={() => toggleOrder(order.id)}
          className="flex w-full items-start justify-between gap-3 text-left"
        >
          <div className="min-w-0">
            <p className="text-xl font-black text-white">
              {expanded ? "▼" : "▶"} Pedido #{" "}
              {Number(order.localOrderNumber || order.id)
                .toString()
                .padStart(6, "0")}
            </p>
            {external && (
              <p className="mt-1 text-sm font-black text-orange-400">
                Plataforma: {platformLabel(order.externalPlatform)} · #
                {order.externalOrderNumber || "—"}
              </p>
            )}
            <p className="mt-1 truncate text-sm text-zinc-400">
              {order.details.customerName || "Mostrador"} · {order.details.orderType}
            </p>
            {!expanded && (
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-zinc-300">
                <span className="rounded-lg bg-zinc-900 px-2 py-1">
                  {productCount} artículo{productCount === 1 ? "" : "s"}
                </span>
                {Array.from(
                  new Set(
                    visibleItems.map(
                      (item) => (item.station || "Cocina") as KitchenStation
                    )
                  )
                ).map((station) => (
                  <span key={station} className="rounded-lg bg-zinc-900 px-2 py-1">
                    {stationIcons[station]} {stationName(station)}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div
            className={`shrink-0 rounded-xl border px-3 py-2 text-sm font-black ${getTimeColor(
              order.createdAt
            )}`}
          >
            ⏱ {getElapsedTime(order.createdAt)}
          </div>
        </button>

        {expanded && (
          <>
            <div className="mt-4 space-y-3">
              {Object.entries(groupedItems)
                .filter(
                  ([station]) =>
                    stationFilter === "Todas" || station === stationFilter
                )
                .map(([station, items]) => (
                  <section
                    key={station}
                    className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3"
                  >
                    <p className="mb-3 text-sm font-black text-orange-400">
                      {stationIcons[station as KitchenStation]}{" "}
                      {stationName(station as KitchenStation)}
                    </p>
                    <div className="space-y-3">
                      {items.map((item) => (
                        <div
                          key={item.id}
                          className="border-b border-zinc-800 pb-3 last:border-0 last:pb-0"
                        >
                          <p className="text-base font-black text-white">
                            {item.quantity} × {item.name}
                          </p>
                          {item.externalName &&
                            item.externalName.trim().toLowerCase() !==
                              item.name.trim().toLowerCase() && (
                              <p className="mt-1 pl-4 text-sm text-zinc-400">
                                ↳ En plataforma: {item.externalName}
                              </p>
                            )}
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
            </div>

            {external &&
              Array.isArray(order.kdsTicketLines) &&
              order.kdsTicketLines.length > 0 && (
                <section className="mt-3 rounded-2xl border border-zinc-700 bg-zinc-900/80 p-4">
                  <p className="text-sm font-black uppercase tracking-wide text-orange-400">
                    Detalle completo del ticket
                  </p>
                  <div className="mt-3 space-y-2">
                    {order.kdsTicketLines.map((line) => {
                      if (line.kind === "selection") {
                        return (
                          <div
                            key={line.id}
                            className="ml-4 rounded-xl border border-zinc-700 bg-black px-3 py-2"
                          >
                            <p className="text-base font-black text-white">
                              {line.quantity} × {line.text}
                            </p>
                          </div>
                        );
                      }

                      if (line.kind === "prompt") {
                        return (
                          <p
                            key={line.id}
                            className="pt-2 text-sm font-black text-orange-300"
                          >
                            {line.text}
                          </p>
                        );
                      }

                      return (
                        <p
                          key={line.id}
                          className="pl-2 text-sm font-semibold text-zinc-300"
                        >
                          {line.text}
                        </p>
                      );
                    })}
                  </div>
                </section>
              )}

            {adjustments.length > 0 && (
              <section className="mt-3 rounded-2xl border border-orange-500/30 bg-orange-500/5 p-3">
                <p className="text-sm font-black text-orange-300">
                  Indicaciones y modificadores
                </p>
                <div className="mt-2 space-y-2">
                  {adjustments.map((adjustment, index) => (
                    <div key={`${adjustment.externalName}-${index}`}>
                      <p className="text-sm font-bold text-white">
                        • {adjustment.externalName || adjustment.name}
                      </p>
                      <p className="pl-4 text-xs text-zinc-400">
                        {adjustment.name}
                        {adjustment.quantity
                          ? ` · ${adjustment.quantity} ${adjustment.unit || ""}`
                          : ""}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {status === "Nuevo" && (
            <button
              onClick={() => updateStatus(order.id, "En preparación")}
              className="rounded-xl border border-blue-500/50 bg-blue-500/15 px-4 py-2 text-xs font-black text-blue-200"
            >
              Preparar
            </button>
          )}
          {status !== "Listo" && (
            <button
              onClick={() => updateStatus(order.id, "Listo")}
              className="rounded-xl border border-green-500/50 bg-green-500/15 px-4 py-2 text-xs font-black text-green-200"
            >
              Listo
            </button>
          )}
          <button
            onClick={() => deliverOrder(order.id)}
            className="rounded-xl bg-orange-500 px-4 py-2 text-xs font-black text-black"
          >
            Entregado
          </button>
        </div>
      </article>
    );
  }

  const kdsContent = (
    <div className={fullscreen ? "min-h-screen bg-black p-4 text-white" : ""}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          {fullscreen && (
            <h1 className="text-3xl font-black text-orange-500">
              KDS {stationFilter === "Todas" ? "General" : stationName(stationFilter)}
            </h1>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => setStationFilter("Todas")}
              className={`rounded-xl border px-3 py-2 text-xs font-black ${
                stationFilter === "Todas"
                  ? "border-orange-400 bg-orange-500 text-black"
                  : "border-zinc-700 bg-zinc-900 text-zinc-300"
              }`}
            >
              Todas
            </button>
            {enabledStations.map((station) => (
              <button
                key={station.id}
                onClick={() => setStationFilter(station.id)}
                className={`rounded-xl border px-3 py-2 text-xs font-black ${
                  stationFilter === station.id
                    ? "border-orange-400 bg-orange-500 text-black"
                    : "border-zinc-700 bg-zinc-900 text-zinc-300"
                }`}
              >
                {stationIcons[station.id]} {station.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowStationSettings((value) => !value)}
            className="rounded-xl border border-orange-500/50 bg-orange-500/10 px-4 py-2 text-xs font-black text-orange-300"
          >
            ⚙ Configurar KDS
          </button>
          <button
            onClick={() => {
              const url = new URL(window.location.href);
              if (fullscreen) url.searchParams.delete("fullscreen");
              else url.searchParams.set("fullscreen", "1");
              window.location.href = url.toString();
            }}
            className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-black text-zinc-200"
          >
            {fullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
          </button>
          <button
            onClick={() => setShowHistory((value) => !value)}
            className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-black text-zinc-200"
          >
            {showHistory
              ? "Volver a pedidos activos"
              : `Historial (${completedOrders.length})`}
          </button>
        </div>
      </div>

      {showStationSettings && (
        <section className="mb-5 rounded-3xl border border-orange-500/30 bg-zinc-950 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-white">Estaciones KDS</h2>
              <p className="mt-1 text-sm text-zinc-400">
                Activa únicamente las estaciones que usa el negocio y cambia el nombre visible.
              </p>
            </div>
            <button
              onClick={persistStationConfig}
              className="rounded-xl bg-orange-500 px-5 py-2 text-sm font-black text-black"
            >
              Guardar configuración
            </button>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {stationConfig.map((station) => (
              <div
                key={station.id}
                className="rounded-2xl border border-zinc-800 bg-black p-4"
              >
                <label className="flex items-center gap-3 text-sm font-black text-white">
                  <input
                    type="checkbox"
                    checked={station.enabled}
                    onChange={(event) =>
                      updateStationConfig(station.id, {
                        enabled: event.target.checked,
                      })
                    }
                    className="h-5 w-5 accent-orange-500"
                  />
                  Usar esta estación
                </label>
                <label className="mt-3 block text-xs font-bold text-zinc-400">
                  Nombre visible
                  <input
                    value={station.name}
                    onChange={(event) =>
                      updateStationConfig(station.id, {
                        name: event.target.value,
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-orange-500"
                  />
                </label>
                {station.enabled && (
                  <button
                    type="button"
                    onClick={() => window.open(stationUrl(station.id), "_blank")}
                    className="mt-3 rounded-lg border border-zinc-700 px-3 py-2 text-xs font-black text-zinc-300"
                  >
                    Abrir KDS {station.name}
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-zinc-500">
            Cada producto conserva su estación base. Cambiar el nombre solo modifica cómo se muestra. Para usar otra PC, abre la URL de su estación en esa computadora. La sincronización entre computadoras requiere que ambas consulten la misma instalación compartida de B-POS.
          </p>
        </section>
      )}

      {showHistory ? (
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {completedOrders.map((order) => renderOrder(order, "Entregado"))}
          {completedOrders.length === 0 && (
            <div className="rounded-3xl border border-dashed border-zinc-700 p-10 text-center text-zinc-500">
              Todavía no hay pedidos entregados.
            </div>
          )}
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {activeColumns.map((status) => (
            <section
              key={status}
              className="min-h-[70vh] rounded-3xl border border-zinc-800 bg-zinc-950 p-4"
            >
              <h2 className="text-xl font-black text-orange-500">{status}</h2>
              <p className="mt-1 text-sm text-zinc-500">
                {ordersByStatus[status].length} pedidos
              </p>
              <div className="mt-5 space-y-4">
                {ordersByStatus[status].map((order) => renderOrder(order, status))}
                {ordersByStatus[status].length === 0 && (
                  <div className="rounded-2xl border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">
                    Sin pedidos
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );

  if (fullscreen) return kdsContent;

  return (
    <AppShell
      title={
        stationFilter === "Todas"
          ? "Cocina KDS"
          : `KDS ${stationName(stationFilter)}`
      }
      subtitle="Estaciones configurables, pedidos compactos, tiempos y doble identificación."
    >
      {kdsContent}
    </AppShell>
  );
}
