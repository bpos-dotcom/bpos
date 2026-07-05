"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";

type SavedOrder = {
  id: number;
  createdAt: string;
  total: number;
};

type Shift = {
  openedAt: string;
  openingCash: number;
  status: "open" | "closed";
};

const ORDERS_KEY = "bpos_orders";
const SHIFT_KEY = "bpos_active_shift";

export default function DashboardPage() {
  const [orders, setOrders] = useState<SavedOrder[]>([]);
  const [shift, setShift] = useState<Shift | null>(null);

  useEffect(() => {
    const savedOrders = localStorage.getItem(ORDERS_KEY);
    const savedShift = localStorage.getItem(SHIFT_KEY);

    if (savedOrders) setOrders(JSON.parse(savedOrders));
    if (savedShift) setShift(JSON.parse(savedShift));
  }, []);

  const todayOrders = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);

    return orders.filter((order) => order.createdAt.slice(0, 10) === today);
  }, [orders]);

  const salesToday = todayOrders.reduce((sum, order) => sum + order.total, 0);
  const averageTicket =
    todayOrders.length > 0 ? salesToday / todayOrders.length : 0;

  return (
    <AppShell
      title="Dashboard"
      subtitle="Resumen real de ventas, pedidos y estado de caja."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Metric title="Ventas hoy" value={`$${salesToday.toFixed(2)}`} />
        <Metric title="Pedidos hoy" value={todayOrders.length.toString()} />
        <Metric title="Ticket promedio" value={`$${averageTicket.toFixed(2)}`} />
        <Metric
          title="Caja"
          value={shift ? "Abierta" : "Cerrada"}
          highlight={shift ? "green" : "orange"}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Estado operativo">
          <div className="space-y-3 text-zinc-300">
            <p>💵 Caja: {shift ? "Abierta" : "Cerrada"}</p>
            <p>
              💰 Fondo inicial:{" "}
              {shift ? `$${shift.openingCash.toFixed(2)}` : "$0.00"}
            </p>
            <p>
              🕒 Apertura:{" "}
              {shift ? new Date(shift.openedAt).toLocaleString() : "Sin turno"}
            </p>
          </div>
        </Panel>

        <Panel title="Módulos activos">
          <ul className="space-y-3 text-zinc-300">
            <li>🛒 POS conectado a caja</li>
            <li>💵 Caja con fondo inicial</li>
            <li>🧾 Historial de pedidos</li>
            <li>📲 WhatsApp desde historial</li>
            <li>🖨️ Ticket imprimible</li>
          </ul>
        </Panel>
      </div>
    </AppShell>
  );
}

function Metric({
  title,
  value,
  highlight = "orange",
}: {
  title: string;
  value: string;
  highlight?: "orange" | "green";
}) {
  const color = highlight === "green" ? "text-green-400" : "text-orange-500";

  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
      <p className="text-sm text-zinc-400">{title}</p>
      <p className={`mt-2 text-3xl font-black ${color}`}>{value}</p>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
      <h2 className="text-xl font-black">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}