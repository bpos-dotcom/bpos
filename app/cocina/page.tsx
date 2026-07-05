"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { SavedOrder } from "@/components/OrderHistoryPanel";
import { KitchenStation } from "@/data/products";

const ORDERS_KEY = "bpos_orders";

type OrderStatus = "Nuevo" | "En preparación" | "Listo" | "Entregado";

type KdsOrder = SavedOrder & {
  status?: OrderStatus;
  kdsCompleted?: boolean;
  kdsReleased?: boolean;
  source?: string;
  externalOrderNumber?: string;
};

const columns: OrderStatus[] = ["Nuevo", "En preparación", "Listo", "Entregado"];

const stationIcons: Record<KitchenStation, string> = {
  Parrilla: "🔥",
  Freidora: "🍟",
  Barra: "🥤",
  Cocina: "👨‍🍳",
};

export default function CocinaPage() {
  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    loadOrders();

    const timer = setInterval(() => {
      setNow(new Date());
      loadOrders();
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  function loadOrders() {
    const savedOrders = localStorage.getItem(ORDERS_KEY);
    if (savedOrders) setOrders(JSON.parse(savedOrders));
  }

  function saveOrders(nextOrders: KdsOrder[]) {
    setOrders(nextOrders);
    localStorage.setItem(ORDERS_KEY, JSON.stringify(nextOrders));
  }

  function updateStatus(id: number, status: OrderStatus) {
    saveOrders(
      orders.map((order) => (order.id === id ? { ...order, status } : order))
    );
  }

  function archiveOrder(id: number) {
    saveOrders(
      orders.map((order) =>
        order.id === id
          ? { ...order, status: "Entregado" as OrderStatus, kdsCompleted: true }
          : order
      )
    );
  }

  function getElapsedTime(createdAt: string) {
    const seconds = Math.floor(
      (now.getTime() - new Date(createdAt).getTime()) / 1000
    );
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    return `${minutes.toString().padStart(2, "0")}:${remainingSeconds
      .toString()
      .padStart(2, "0")}`;
  }

  function getTimeColor(createdAt: string) {
    const minutes = Math.floor(
      (now.getTime() - new Date(createdAt).getTime()) / 60000
    );

    if (minutes >= 10) return "text-red-400 border-red-500/40 bg-red-500/10";
    if (minutes >= 5)
      return "text-yellow-300 border-yellow-500/40 bg-yellow-500/10";

    return "text-green-300 border-green-500/40 bg-green-500/10";
  }

  function groupItemsByStation(order: KdsOrder) {
    return order.items.reduce((acc, item) => {
      const station = (item.station || "Cocina") as KitchenStation;

      if (!acc[station]) acc[station] = [];

      acc[station].push(item);

      return acc;
    }, {} as Record<KitchenStation, typeof order.items>);
  }

  const visibleOrders = orders.filter((order) => {
    if (order.kdsCompleted) return false;

    if (order.source === "B-POS Bridge") {
      return order.kdsReleased === true;
    }

    return true;
  });

  const ordersByStatus = useMemo(() => {
    return columns.reduce((acc, status) => {
      acc[status] = visibleOrders.filter(
        (order) => (order.status || "Nuevo") === status
      );
      return acc;
    }, {} as Record<OrderStatus, KdsOrder[]>);
  }, [visibleOrders]);

  return (
    <AppShell
      title="Cocina KDS"
      subtitle="Pedidos locales y pedidos enviados desde B-POS Bridge, agrupados por estación."
    >
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        {columns.map((status) => (
          <section
            key={status}
            className="min-h-[70vh] rounded-3xl border border-zinc-800 bg-zinc-950 p-5"
          >
            <h2 className="text-xl font-black text-orange-500">{status}</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {ordersByStatus[status].length} pedidos
            </p>

            <div className="mt-5 space-y-4">
              {ordersByStatus[status].map((order) => {
                const groupedItems = groupItemsByStation(order);

                return (
                  <div
                    key={order.id}
                    className="rounded-2xl border border-zinc-800 bg-black p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-black">
                          Pedido #{order.id.toString().padStart(6, "0")}
                        </p>

                        <p className="text-sm text-zinc-400">
                          {order.details.customerName || "Mostrador"} ·{" "}
                          {order.details.orderType}
                        </p>

                        {order.source === "B-POS Bridge" && (
                          <p className="mt-2 inline-block rounded-xl border border-orange-500/40 bg-orange-500/10 px-3 py-1 text-xs font-black text-orange-300">
                            🌉 B-POS Bridge ·{" "}
                            {order.details.orderType.includes("Didi")
                              ? "Didi"
                              : order.details.orderType.includes("Uber")
                              ? "Uber"
                              : "Pedido"}{" "}
                            #{order.externalOrderNumber}
                          </p>
                        )}
                      </div>

                      <div
                        className={`rounded-xl border px-3 py-2 text-sm font-black ${getTimeColor(
                          order.createdAt
                        )}`}
                      >
                        ⏱ {getElapsedTime(order.createdAt)}
                      </div>
                    </div>

                    <div className="mt-4 space-y-3">
                      {Object.entries(groupedItems).map(([station, items]) => (
                        <div
                          key={station}
                          className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3"
                        >
                          <p className="mb-2 text-sm font-black text-orange-400">
                            {stationIcons[station as KitchenStation]} {station}
                          </p>

                          <div className="space-y-1 text-sm text-zinc-300">
                            {items.map((item) => (
                              <p key={item.id}>
                                {item.quantity} × {item.name}
                              </p>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {status !== "En preparación" && status !== "Entregado" && (
                        <button
                          onClick={() =>
                            updateStatus(order.id, "En preparación")
                          }
                          className="rounded-xl border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-xs font-black text-blue-300"
                        >
                          Preparar
                        </button>
                      )}

                      {status !== "Listo" && status !== "Entregado" && (
                        <button
                          onClick={() => updateStatus(order.id, "Listo")}
                          className="rounded-xl border border-green-500/40 bg-green-500/10 px-3 py-2 text-xs font-black text-green-300"
                        >
                          Listo
                        </button>
                      )}

                      {status !== "Entregado" && (
                        <button
                          onClick={() => updateStatus(order.id, "Entregado")}
                          className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-black text-zinc-200"
                        >
                          Entregado
                        </button>
                      )}

                      {status === "Entregado" && (
                        <button
                          onClick={() => archiveOrder(order.id)}
                          className="rounded-xl bg-orange-500 px-3 py-2 text-xs font-black text-black"
                        >
                          Archivar
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {ordersByStatus[status].length === 0 && (
                <div className="rounded-2xl border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">
                  Sin pedidos
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}