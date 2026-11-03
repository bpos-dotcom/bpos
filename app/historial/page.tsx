"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { OrderHistoryPanel, saleSource, type SavedOrder } from "@/components/OrderHistoryPanel";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { getCashCloseHistory } from "@/lib/cash-history";
import { formatOrderNumber } from "@/lib/order-sequence";
import { cancelSavedOrder, changeSavedOrderPayment, loadSavedOrders, markSavedOrderPaid, printSaleTicket, sendSaleWhatsapp } from "@/lib/sale-actions";

const PLATFORM_LABEL: Record<string, string> = { uber: "Uber Eats", didi: "DiDi Food", rappi: "Rappi" };

/** Periodo a mostrar: el turno abierto, uno de los últimos turnos cerrados, un rango de fechas o todo */
type Period = { key: string; label: string; sessionId?: string; from?: string; to?: string };

const fmt = (iso: string) => new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dayStart = (d: string) => new Date(`${d}T00:00:00`).getTime();
const dayEnd = (d: string) => new Date(`${d}T23:59:59.999`).getTime();

function readActiveShift(): { sessionId: string; openedAt: string } | null {
  try {
    const raw = localStorage.getItem("bpos_active_shift");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sessionId?: string; openedAt?: string };
    return parsed.sessionId && parsed.openedAt ? { sessionId: parsed.sessionId, openedAt: parsed.openedAt } : null;
  } catch {
    return null;
  }
}

function inPeriod(order: SavedOrder & { shiftSessionId?: string }, period: Period, openedAt?: string) {
  if (period.sessionId) {
    if (order.shiftSessionId) return order.shiftSessionId === period.sessionId;
    // Ventas viejas sin turno: por la hora de apertura del turno abierto
    return Boolean(openedAt) && period.key === "actual" && new Date(order.createdAt) >= new Date(openedAt as string);
  }
  if (period.from || period.to) {
    const t = new Date(order.createdAt).getTime();
    return (!period.from || t >= dayStart(period.from)) && (!period.to || t <= dayEnd(period.to));
  }
  return true;
}

/**
 * Historial de pedidos: todas las ventas (del más reciente al más viejo) con
 * filtro por origen, reimpresión, WhatsApp, cambio de método de pago (con PIN
 * de administrador) y cancelación. Abajo, el resumen de pedidos de plataforma.
 */
export default function OrderHistoryPage() {
  const [orders, setOrders] = useState<SavedOrder[]>([]);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [shift, setShift] = useState<{ sessionId: string; openedAt: string } | null>(null);
  const [closed, setClosed] = useState<{ sessionId: string; openedAt: string; closedAt: string; folio: string }[]>([]);
  const [periodKey, setPeriodKey] = useState("actual");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    const load = () => {
      setOrders([...loadSavedOrders()].reverse());
      setShift(readActiveShift());
      // Los dos últimos turnos cerrados antes del actual
      setClosed(
        getCashCloseHistory()
          .slice()
          .sort((a, b) => b.closedAt.localeCompare(a.closedAt))
          .slice(0, 2)
          .map((r) => ({ sessionId: r.shiftSessionId, openedAt: r.openedAt, closedAt: r.closedAt, folio: r.folio }))
      );
    };
    load();
    setUser(getCurrentUser());
    window.addEventListener("storage", load);
    window.addEventListener("bpos:orders-updated", load);
    return () => {
      window.removeEventListener("storage", load);
      window.removeEventListener("bpos:orders-updated", load);
    };
  }, []);

  const periods: Period[] = useMemo(
    () => [
      ...(shift ? [{ key: "actual", label: `Turno actual (desde ${fmt(shift.openedAt)})`, sessionId: shift.sessionId }] : []),
      ...closed.map((c, i) => ({ key: `cerrado-${i}`, label: `Turno ${c.folio} · ${fmt(c.openedAt)} → ${fmt(c.closedAt)}`, sessionId: c.sessionId })),
      { key: "rango", label: "Rango de fechas…" },
      { key: "todo", label: "Todos los pedidos" },
    ],
    [shift, closed]
  );
  const period = periods.find((p) => p.key === periodKey) || periods[periods.length - 1];
  const effective: Period = period.key === "rango" ? { ...period, from, to } : period;
  const visible = useMemo(() => orders.filter((o) => inPeriod(o, effective, shift?.openedAt)), [orders, effective, shift]);
  const platformOrders = visible.filter((o) => Boolean(o.externalOrderNumber));
  const visibleTotal = visible.filter((o) => !o.cancelled).reduce((s, o) => s + o.total, 0);

  return (
    <AppShell title="Historial de pedidos" subtitle="Reimprime, reenvía por WhatsApp, corrige el método de pago o cancela una venta.">
      <div className="space-y-6">
        {/* Periodo: turno abierto, últimos turnos cerrados o fechas */}
        <section className="flex flex-wrap items-center gap-3 rounded-3xl border border-zinc-800 bg-zinc-950 p-4">
          <label className="text-sm font-bold text-zinc-400">Periodo</label>
          <select value={period.key} onChange={(e) => setPeriodKey(e.target.value)} className="rounded-xl border border-zinc-800 bg-black px-3 py-2 text-sm font-black text-white">
            {periods.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
          {period.key === "rango" && (
            <>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-xl border border-zinc-800 bg-black px-3 py-2 text-sm text-white" />
              <span className="text-sm text-zinc-500">a</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-xl border border-zinc-800 bg-black px-3 py-2 text-sm text-white" />
            </>
          )}
          <span className="text-sm text-zinc-500">
            {visible.length} pedidos · ${visibleTotal.toFixed(2)}
          </span>
        </section>

        <OrderHistoryPanel
          orders={visible}
          userRole={user?.role === "Admin" ? "Admin" : "Cajero"}
          onDelete={(id) => {
            const order = orders.find((o) => o.id === id);
            if (order) void cancelSavedOrder(order, user);
          }}
          onPrint={printSaleTicket}
          onWhatsapp={sendSaleWhatsapp}
          onMarkPaid={(order, method) => markSavedOrderPaid(order, method, user)}
          onChangePayment={(order, method) => changeSavedOrderPayment(order, method, user)}
        />

        {platformOrders.length > 0 && (
          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <h2 className="text-xl font-black text-orange-500">Pedidos de plataforma</h2>
            <p className="mt-1 text-sm text-zinc-400">Los cobra la plataforma: no entran al efectivo de la caja.</p>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {platformOrders.map((order) => (
                <div key={`platform-${order.id}`} className="rounded-2xl border border-zinc-800 bg-black p-4">
                  <p className="font-black text-white">Pedido #{formatOrderNumber(order as SavedOrder & { localOrderNumber?: number })}</p>
                  <p className="mt-1 text-sm font-bold text-orange-300">
                    {PLATFORM_LABEL[saleSource(order)] || "Plataforma"} · #{order.externalOrderNumber} · ${order.total.toFixed(2)}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">{order.details.customerName || "Cliente de plataforma"}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
