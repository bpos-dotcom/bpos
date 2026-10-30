"use client";
/**
 * Pedidos en línea: lo que mandan los clientes desde el menú digital de la
 * sucursal. Nuevos (aceptar con tiempo estimado o rechazar con motivo),
 * en preparación (marcar listo / entregado) y los de hoy.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { getCurrentUser } from "@/lib/auth";
import { DIGITAL_MENU_EVENT, getDigitalMenu } from "@/lib/digital-menu";
import {
  ONLINE_ORDERS_EVENT,
  acceptOnlineOrder,
  buildOnlineCart,
  listOnlineOrders,
  markOnlineOrder,
  rejectOnlineOrder,
  type OnlineOrder,
} from "@/lib/online-orders";

const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;
const ago = (iso: string) => {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return min < 1 ? "ahora" : min < 60 ? `hace ${min} min` : new Date(iso).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });
};
const TYPE_ICON = { Recoger: "🛍️ Recoger", Domicilio: "🛵 Domicilio", Mesa: "🍽️ Mesa" } as const;

function OrderCard({ order, onChanged }: { order: OnlineOrder; onChanged: () => void }) {
  const menu = getDigitalMenu();
  const [eta, setEta] = useState(menu.prepMinutes);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const d = order.data;
  const problems = order.status === "nuevo" ? buildOnlineCart(d).problems : [];

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      onChanged();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo.");
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    await run(async () => {
      const result = await acceptOnlineOrder(order, eta, getCurrentUser()?.name);
      if (result.printFailed.length) setMessage(`Aceptado. No se imprimió en: ${result.printFailed.join(", ")}. Reimprime desde Impresiones.`);
    });
  }

  async function reject() {
    const reason = prompt("¿Por qué no puedes tomar el pedido? (se le muestra al cliente)", "Por ahora no podemos tomar tu pedido. ¡Disculpa!");
    if (reason === null) return;
    await run(() => rejectOnlineOrder(order, reason, getCurrentUser()?.name));
  }

  const isNew = order.status === "nuevo" || order.status === "aceptando";
  return (
    <div className={`rounded-3xl border p-5 ${isNew ? "border-emerald-400 bg-emerald-500/5" : "border-zinc-800 bg-zinc-950"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-2xl font-black tracking-widest">{order.folio}</p>
          <p className="text-sm text-zinc-400">
            {TYPE_ICON[d.type]}
            {d.type === "Mesa" && d.table ? ` ${d.table}` : ""} · {ago(order.created_at)}
          </p>
        </div>
        <p className="text-2xl font-black text-orange-400">{money(d.total)}</p>
      </div>

      <div className="mt-3 rounded-2xl bg-black p-3 text-sm">
        <p className="font-black">{d.customer.name}</p>
        {d.customer.phone && (
          <a href={`https://wa.me/52${d.customer.phone.slice(-10)}`} target="_blank" rel="noreferrer" className="text-emerald-400 underline">
            📱 {d.customer.phone}
          </a>
        )}
        {d.customer.address && <p className="text-zinc-300">📍 {d.customer.address}{d.customer.reference ? ` · ${d.customer.reference}` : ""}</p>}
        <p className="text-zinc-400">
          Paga con {d.payment}
          {d.cashWith ? ` (trae ${money(d.cashWith)})` : ""}
        </p>
        {d.note && <p className="mt-1 italic text-yellow-200">“{d.note}”</p>}
      </div>

      <ul className="mt-3 space-y-1 text-sm">
        {d.lines.map((l, i) => (
          <li key={i}>
            <b>{l.quantity} ×</b> {l.name} <span className="text-zinc-500">{money(l.unitPrice * l.quantity)}</span>
            {l.summary && <p className="pl-5 text-xs text-zinc-400">{l.summary}</p>}
            {l.comment && <p className="pl-5 text-xs italic text-yellow-200">“{l.comment}”</p>}
          </li>
        ))}
        {d.deliveryFee > 0 && <li className="text-zinc-400">Envío {money(d.deliveryFee)}</li>}
      </ul>

      {problems.length > 0 && (
        <ul className="mt-3 list-disc rounded-2xl border border-yellow-500/40 bg-yellow-500/10 p-3 pl-7 text-xs text-yellow-100">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}

      {isNew && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm font-bold text-zinc-300">
            Listo en
            <select value={eta} onChange={(e) => setEta(Number(e.target.value))} className="rounded-xl border border-zinc-700 bg-black px-2 py-2">
              {[10, 15, 20, 25, 30, 40, 50, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
          </label>
          <button disabled={busy} onClick={() => void accept()} className="flex-1 rounded-2xl bg-emerald-500 px-5 py-3 font-black text-black disabled:opacity-50">
            {busy ? "..." : "✅ Aceptar y mandar a cocina"}
          </button>
          <button disabled={busy} onClick={() => void reject()} className="rounded-2xl border border-red-500/60 px-4 py-3 font-black text-red-300 disabled:opacity-50">
            Rechazar
          </button>
        </div>
      )}
      {order.status === "aceptado" && (
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-xl bg-zinc-800 px-3 py-2 text-sm font-bold">👨‍🍳 En preparación · Pedido #{order.sale_order_id}</span>
          <button disabled={busy} onClick={() => void run(() => markOnlineOrder(order, "listo"))} className="rounded-2xl bg-orange-500 px-4 py-2 font-black text-black">
            {d.type === "Domicilio" ? "Salió a entregar" : "Ya está listo"}
          </button>
        </div>
      )}
      {order.status === "listo" && (
        <button disabled={busy} onClick={() => void run(() => markOnlineOrder(order, "entregado"))} className="mt-4 rounded-2xl border border-zinc-700 px-4 py-2 font-black">
          Marcar entregado
        </button>
      )}
      {order.status === "rechazado" && <p className="mt-3 text-sm text-red-300">Rechazado: {order.reason}</p>}
      {order.status === "entregado" && <p className="mt-3 text-sm text-zinc-500">Entregado ✅</p>}
      {message && <p className="mt-3 text-sm font-bold text-yellow-200">{message}</p>}
    </div>
  );
}

export default function PedidosEnLineaPage() {
  const [orders, setOrders] = useState<OnlineOrder[] | null>(null);
  const [error, setError] = useState("");
  const [menuOn, setMenuOn] = useState(true);

  const load = useCallback(async () => {
    try {
      setOrders(await listOnlineOrders());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los pedidos.");
    }
  }, []);

  useEffect(() => {
    const m = getDigitalMenu();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ajuste del navegador: solo después de montar
    setMenuOn(m.enabled && Boolean(m.slug));
    void load();
    const timer = setInterval(() => void load(), 10_000);
    const refresh = () => {
      const menu = getDigitalMenu();
      setMenuOn(menu.enabled && Boolean(menu.slug));
      void load();
    };
    window.addEventListener(ONLINE_ORDERS_EVENT, refresh);
    window.addEventListener(DIGITAL_MENU_EVENT, refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener(ONLINE_ORDERS_EVENT, refresh);
      window.removeEventListener(DIGITAL_MENU_EVENT, refresh);
    };
  }, [load]);

  const fresh = (orders || []).filter((o) => o.status === "nuevo" || o.status === "aceptando");
  const preparing = (orders || []).filter((o) => o.status === "aceptado" || o.status === "listo");
  const done = (orders || []).filter((o) => o.status === "entregado" || o.status === "rechazado");

  return (
    <AppShell title="Pedidos en línea" subtitle="Lo que te piden desde tu menú digital, sin comisiones.">
      <div className="space-y-6">
        {!menuOn && (
          <div className="rounded-3xl border border-orange-500/40 bg-orange-500/10 p-5">
            <p className="font-black text-orange-200">Tu menú digital no está publicado.</p>
            <Link href="/configuracion/menu-digital" className="mt-2 inline-block rounded-2xl bg-orange-500 px-4 py-2 font-black text-black">
              Configurar menú digital
            </Link>
          </div>
        )}
        {error && <p className="text-sm text-red-300">{error}</p>}
        {orders === null && !error && <p className="text-zinc-500">Cargando...</p>}

        <div className="grid gap-6 xl:grid-cols-3">
          <section>
            <h2 className="mb-3 text-lg font-black">🔔 Nuevos ({fresh.length})</h2>
            <div className="space-y-4">
              {fresh.map((o) => <OrderCard key={o.id} order={o} onChanged={() => void load()} />)}
              {orders && fresh.length === 0 && <p className="rounded-3xl border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">Sin pedidos nuevos.</p>}
            </div>
          </section>
          <section>
            <h2 className="mb-3 text-lg font-black">👨‍🍳 En preparación ({preparing.length})</h2>
            <div className="space-y-4">{preparing.map((o) => <OrderCard key={o.id} order={o} onChanged={() => void load()} />)}</div>
          </section>
          <section>
            <h2 className="mb-3 text-lg font-black">📋 Terminados hoy ({done.length})</h2>
            <div className="space-y-4">{done.map((o) => <OrderCard key={o.id} order={o} onChanged={() => void load()} />)}</div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
