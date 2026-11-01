"use client";
/**
 * Pedidos en línea: lo que mandan los clientes desde el menú digital de la
 * sucursal. Nuevos (aceptar con tiempo estimado o rechazar con motivo),
 * en preparación (marcar listo / entregado) y los de hoy.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { DispatchModal } from "@/components/delivery/DispatchModal";
import { getCurrentUser } from "@/lib/auth";
import { DIGITAL_MENU_EVENT, awaitingOnlinePayment, getDigitalMenu, mapsLink, paidOnline, scheduledLabel, scheduledLater, whatsappNumber } from "@/lib/digital-menu";
import {
  ONLINE_ORDERS_EVENT,
  acceptOnlineOrder,
  buildOnlineCart,
  customerWhatsappLink,
  listOnlineOrders,
  markOnlineOrder,
  noticeFor,
  onlineDispatchInfo,
  onlinePaymentShort,
  rejectOnlineOrder,
  type CustomerNotice,
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
  const [dispatching, setDispatching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  /** Envío a cotizar: lo que cobrará el negocio por llevarlo (se captura antes de aceptar) */
  const [shipFee, setShipFee] = useState("");
  const d = order.data;
  const short = order.status === "nuevo" ? onlinePaymentShort(d) : "";
  const problems = order.status === "nuevo" ? [...buildOnlineCart(d).problems, ...(short ? [short] : [])] : [];

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      onChanged();
      return true;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Cambia el estado y abre WhatsApp con el aviso para el cliente. La ventana
   * se abre en el mismo clic (si no, el navegador la bloquea) y se llena al
   * terminar; si algo falla, se cierra.
   */
  async function step(notice: CustomerNotice, action: () => Promise<unknown>, opts: { eta?: number; reason?: string } = {}, orderForNotice: OnlineOrder = order) {
    const link = menu.whatsappNotify ? customerWhatsappLink(orderForNotice, notice, opts) : "";
    const w = link ? window.open("", "_blank") : null;
    const ok = await run(action);
    if (ok && w) w.location.href = link;
    else w?.close();
  }

  const quoting = d.type === "Domicilio" && Boolean(d.deliveryQuote);

  async function accept() {
    // Programado: el tiempo estimado es lo que falta para su hora
    const etaUse = d.scheduledFor ? Math.max(5, Math.round((Date.parse(d.scheduledFor) - Date.now()) / 60000)) : eta;
    let fee = 0;
    let noticeOrder = order;
    if (quoting) {
      fee = Number(shipFee.replace(",", "."));
      if (!shipFee.trim() || !Number.isFinite(fee) || fee < 0) {
        alert("Pon el costo de envío (puede ser 0). Mira su ubicación en el mapa para cotizarlo.");
        return;
      }
      noticeOrder = { ...order, data: { ...d, deliveryFee: fee, total: Math.max(0, Number(d.subtotal) + fee - (d.coupon?.discount || 0)) } };
    }
    await step(
      "aceptado",
      async () => {
        const result = await acceptOnlineOrder(order, etaUse, getCurrentUser()?.name, quoting ? { deliveryFee: fee } : {});
        if (result.printFailed.length) setMessage(`Aceptado. No se imprimió en: ${result.printFailed.join(", ")}. Reimprime desde Impresiones.`);
        // A domicilio: de una vez elegir quién lo lleva
        if (order.data.type === "Domicilio") setDispatching(true);
      },
      { eta: etaUse },
      noticeOrder
    );
  }

  async function reject() {
    const reason = prompt("¿Por qué no puedes tomar el pedido? (se le muestra al cliente)", "Por ahora no podemos tomar tu pedido. ¡Disculpa!");
    if (reason === null) return;
    await step(
      "rechazado",
      async () => {
        const { refundError } = await rejectOnlineOrder(order, reason, getCurrentUser()?.name);
        if (refundError) alert(refundError);
      },
      { reason }
    );
  }

  // Para volver a mandar el aviso del estado actual
  const notice = noticeFor(order.status);
  const resend = notice ? customerWhatsappLink(order, notice) : "";

  const isNew = order.status === "nuevo" || order.status === "aceptando";
  const later = isNew && scheduledLater(d, menu.scheduling.leadMinutes);
  const phone = whatsappNumber(d.customer.phone);
  const confirmLink =
    later && phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(`¡Hola ${d.customer.name.split(" ")[0]}! Recibimos tu pedido programado ${order.folio} para ${scheduledLabel(d.scheduledFor!)}. ¡Te esperamos! 🧡`)}`
      : "";
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

      {d.scheduledFor && (
        <p className="mt-3 rounded-2xl border border-sky-500/50 bg-sky-500/10 px-3 py-2 text-sm font-black text-sky-300">
          📅 Programado para {scheduledLabel(d.scheduledFor)}
          {later && <span className="block text-xs font-bold text-sky-200/80">Se manda solo a cocina {menu.scheduling.leadMinutes} min antes (con caja abierta).</span>}
          {!order.account_id && <span className="block text-xs font-bold text-yellow-300">⚠️ Sin cuenta del cliente</span>}
        </p>
      )}
      <div className="mt-3 rounded-2xl bg-black p-3 text-sm">
        <p className="font-black">{d.customer.name}</p>
        {d.customer.phone && (
          <a href={`https://wa.me/52${d.customer.phone.slice(-10)}`} target="_blank" rel="noreferrer" className="text-emerald-400 underline">
            📱 {d.customer.phone}
          </a>
        )}
        {d.customer.address && <p className="text-zinc-300">📍 {d.customer.address}{d.customer.reference ? ` · ${d.customer.reference}` : ""}</p>}
        {mapsLink(d.customer.location) && (
          <a href={mapsLink(d.customer.location)} target="_blank" rel="noreferrer" className="text-sky-400 underline">
            🗺️ Ver ubicación en el mapa
          </a>
        )}
        {quoting && isNew && (
          <label className="mt-2 block rounded-2xl border border-orange-500/50 bg-orange-500/10 p-3 font-black text-orange-300">
            🚚 Costo de envío $
            <input
              type="number"
              min={0}
              inputMode="decimal"
              value={shipFee}
              onChange={(e) => setShipFee(e.target.value)}
              placeholder="0"
              className="mt-1 w-full rounded-xl border border-zinc-700 bg-black px-3 py-2 text-lg text-white"
            />
            <span className="mt-1 block text-xs font-bold text-orange-200/80">
              El cliente pidió con envío por cotizar: mira el mapa, pon lo que cobrarás y acepta. Se le avisa y su total se actualiza.{paidOnline(d) ? " Ya pagó los productos: el envío se cobra al entregar." : ""}
            </span>
          </label>
        )}
        {quoting && !isNew && <p className="text-zinc-300">🚚 Envío cotizado: {money(d.deliveryFee || 0)}{paidOnline(d) && d.deliveryFee ? " (cobrar al entregar)" : ""}</p>}
        {paidOnline(d) ? (
          <p className="font-black text-emerald-400">✅ Pagado con Mercado Pago · {money(d.mp?.amount || 0)}</p>
        ) : d.mp?.status === "refunded" ? (
          <p className="font-black text-sky-300">↩️ Pago de Mercado Pago devuelto</p>
        ) : (
          <p className="text-zinc-400">
            Paga con {d.payment}
            {d.cashWith ? ` (trae ${money(d.cashWith)})` : ""}
          </p>
        )}
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
        {d.coupon && <li className="text-emerald-400">🎟️ Cupón {d.coupon.code} -{money(d.coupon.discount)}</li>}
      </ul>

      {problems.length > 0 && (
        <ul className="mt-3 list-disc rounded-2xl border border-yellow-500/40 bg-yellow-500/10 p-3 pl-7 text-xs text-yellow-100">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}

      {confirmLink && (
        <a href={confirmLink} target="_blank" rel="noreferrer" className="mt-3 inline-block rounded-xl border border-emerald-500/50 px-3 py-1.5 text-xs font-black text-emerald-300">
          📲 Confirmar al cliente por WhatsApp
        </a>
      )}
      {isNew && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!d.scheduledFor && (
          <label className="flex items-center gap-2 text-sm font-bold text-zinc-300">
            Listo en
            <select value={eta} onChange={(e) => setEta(Number(e.target.value))} className="rounded-xl border border-zinc-700 bg-black px-2 py-2">
              {[10, 15, 20, 25, 30, 40, 50, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
          </label>
          )}
          <button disabled={busy} onClick={() => void accept()} className="flex-1 rounded-2xl bg-emerald-500 px-5 py-3 font-black text-black disabled:opacity-50">
            {busy ? "..." : later ? "👨‍🍳 Mandar a cocina ya" : "✅ Aceptar y mandar a cocina"}
          </button>
          <button disabled={busy} onClick={() => void reject()} className="rounded-2xl border border-red-500/60 px-4 py-3 font-black text-red-300 disabled:opacity-50">
            Rechazar
          </button>
        </div>
      )}
      {order.status === "aceptado" && (
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-xl bg-zinc-800 px-3 py-2 text-sm font-bold">👨‍🍳 En preparación · Pedido #{order.sale_order_id}</span>
          {d.type === "Domicilio" && (
            <button onClick={() => setDispatching(true)} className="rounded-2xl border border-orange-500 px-4 py-2 font-black text-orange-300">
              🛵 Mandar a repartidor
            </button>
          )}
          <button disabled={busy} onClick={() => void step("listo", () => markOnlineOrder(order, "listo"))} className="rounded-2xl bg-orange-500 px-4 py-2 font-black text-black">
            {d.type === "Domicilio" ? "Salió a entregar" : "Ya está listo"}
          </button>
        </div>
      )}
      {order.status === "listo" && (
        <button disabled={busy} onClick={() => void step("entregado", () => markOnlineOrder(order, "entregado"))} className="mt-4 rounded-2xl border border-zinc-700 px-4 py-2 font-black">
          Marcar entregado
        </button>
      )}
      {order.status === "rechazado" && <p className="mt-3 text-sm text-red-300">Rechazado: {order.reason}</p>}
      {order.status === "entregado" && <p className="mt-3 text-sm text-zinc-500">Entregado ✅</p>}
      {resend && (
        <a href={resend} target="_blank" rel="noreferrer" className="mt-3 inline-block rounded-xl border border-emerald-500/50 px-3 py-1.5 text-xs font-black text-emerald-300 hover:bg-emerald-500/10">
          📲 Avisar al cliente por WhatsApp
        </a>
      )}
      {message && <p className="mt-3 text-sm font-bold text-yellow-200">{message}</p>}
      {dispatching && <DispatchModal info={onlineDispatchInfo(order)} saleId={order.sale_order_id || undefined} onClose={() => setDispatching(false)} />}
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

  const leadMinutes = getDigitalMenu().scheduling.leadMinutes;
  const unpaid = (orders || []).filter((o) => o.status === "nuevo" && awaitingOnlinePayment(o.data));
  const isPending = (o: OnlineOrder) => (o.status === "nuevo" || o.status === "aceptando") && !awaitingOnlinePayment(o.data);
  const programmed = (orders || []).filter((o) => isPending(o) && scheduledLater(o.data, leadMinutes)).sort((a, b) => (a.data.scheduledFor || "").localeCompare(b.data.scheduledFor || ""));
  const fresh = (orders || []).filter((o) => isPending(o) && !scheduledLater(o.data, leadMinutes));
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
            {unpaid.length > 0 && (
              <p className="mt-4 rounded-2xl border border-sky-500/40 bg-sky-500/10 p-3 text-sm text-sky-200">
                ⏳ Pagando con Mercado Pago: {unpaid.map((o) => `${o.folio} (${money(o.data.total)})`).join(", ")}. Aparecen aquí en cuanto se aprueba el pago.
              </p>
            )}
            {programmed.length > 0 && (
              <>
                <h2 className="mb-3 mt-6 text-lg font-black">📅 Programados ({programmed.length})</h2>
                <div className="space-y-4">{programmed.map((o) => <OrderCard key={o.id} order={o} onChanged={() => void load()} />)}</div>
              </>
            )}
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
