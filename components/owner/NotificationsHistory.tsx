"use client";
/**
 * App del dueño → 🔔 Avisos: historial de las notificaciones (pedidos de
 * delivery, ventas grandes, cortes, cancelaciones, seguridad), con el mismo
 * texto del aviso, para ver a qué se refería uno después de tocarlo.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { loadOwnerNotifications } from "@/lib/cloud/audit-outbox";
import { getPushPrefs } from "@/lib/push/client";
import { loadCloudOrder, type ReportOrder } from "@/lib/reports";

type Item = NonNullable<Awaited<ReturnType<typeof loadOwnerNotifications>>>[number];

/** Avisos de un pedido: al tocarlos se abre el pedido */
const ORDER_ACTIONS = new Set(["delivery.received", "sale.created", "sale.cancelled"]);
const money = (n: number) => `$${(Number(n) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type FullOrder = Omit<ReportOrder, "items" | "details"> & {
  externalOrderNumber?: string;
  cancelled?: boolean;
  cancelReason?: string;
  cancelledBy?: string;
  tip?: number;
  details?: ReportOrder["details"] & { customerPhone?: string; notes?: string; tableName?: string };
  items: (ReportOrder["items"][number] & { comment?: string; notes?: string })[];
};

/** Pop-up con lo que fue el pedido del aviso */
function OrderSheet({ item, onClose }: { item: Item; onClose: () => void }) {
  const [order, setOrder] = useState<FullOrder | null | undefined>(undefined);
  const [error, setError] = useState("");
  useEffect(() => {
    loadCloudOrder(item.entityId || "")
      .then((o) => setOrder(o as FullOrder | null))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar el pedido."));
  }, [item.entityId]);
  const number = order
    ? order.externalOrderNumber
      ? `${order.externalPlatform || ""} #${order.externalOrderNumber}`
      : `#${String(order.localOrderNumber ?? order.id).padStart(6, "0")}`
    : "";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 sm:items-center" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-3xl border border-zinc-800 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Detalle del pedido">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-black">{item.title}</p>
            <p className="text-xs text-zinc-500">
              {when(item.at)}
              {item.by ? ` · por ${item.by}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="rounded-xl border border-zinc-800 px-3 py-1 text-sm font-black" aria-label="Cerrar">
            ✕
          </button>
        </div>
        {error && <p className="mt-4 rounded-2xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        {!error && order === undefined && <p className="py-8 text-center text-sm text-zinc-500">Cargando pedido...</p>}
        {!error && order === null && <p className="mt-4 text-sm text-zinc-400">Este pedido ya no está en la nube. {item.body}</p>}
        {order && (
          <div className="mt-4 space-y-3 text-sm">
            <div className="rounded-2xl bg-black/40 p-3">
              <p className="font-black">Pedido {number}</p>
              <p className="text-xs text-zinc-400">
                {[order.details?.orderType, order.details?.paymentMethod, order.details?.tableName, new Date(order.createdAt).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {(order.details?.customerName || order.details?.customerPhone) && (
                <p className="mt-1 text-xs text-zinc-300">👤 {[order.details?.customerName, order.details?.customerPhone].filter(Boolean).join(" · ")}</p>
              )}
              {order.cancelled && (
                <p className="mt-2 rounded-xl border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs font-bold text-red-300">
                  ❌ Cancelado{order.cancelledBy ? ` por ${order.cancelledBy}` : ""}
                  {order.cancelReason ? `: ${order.cancelReason}` : ""}
                </p>
              )}
            </div>
            <ul className="divide-y divide-zinc-800">
              {(order.items || []).map((it, i) => (
                <li key={i} className="py-2">
                  <p className="flex justify-between gap-3 font-bold">
                    <span>
                      {it.quantity}× {it.name}
                    </span>
                    <span>{money(it.price * it.quantity)}</span>
                  </p>
                  {(it.modifiers || []).length > 0 && <p className="text-xs text-zinc-400">{(it.modifiers || []).map((m) => (m.price ? `${m.name} (+${money(m.price)})` : m.name)).join(" · ")}</p>}
                  {(it.parts || []).length > 0 && <p className="text-xs text-zinc-500">{(it.parts || []).map((p) => `${(Number(p.quantity) || 1) * (Number(it.quantity) || 1)}× ${p.name}`).join(" · ")}</p>}
                  {(it.comment || it.notes) && <p className="text-xs text-yellow-300">📝 {it.comment || it.notes}</p>}
                </li>
              ))}
            </ul>
            {order.details?.notes && <p className="text-xs text-yellow-300">📝 {order.details.notes}</p>}
            <div className="space-y-1 border-t border-zinc-800 pt-3">
              {Boolean(order.details?.discount) && (
                <p className="flex justify-between text-zinc-400">
                  <span>Descuento</span>
                  <span>-{money(order.details?.discount || 0)}</span>
                </p>
              )}
              {Boolean(order.tip) && (
                <p className="flex justify-between text-zinc-400">
                  <span>Propina</span>
                  <span>{money(order.tip || 0)}</span>
                </p>
              )}
              <p className="flex justify-between text-base font-black">
                <span>Total</span>
                <span className="text-orange-500">{money(order.total)}</span>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function when(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  const time = d.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Hoy ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Ayer ${time}`;
  return `${d.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" })} ${time}`;
}

export function NotificationsHistory() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Item | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await loadOwnerNotifications(getPushPrefs());
      if (list === null) setError("Inicia sesión con la cuenta del negocio para ver los avisos.");
      else {
        setItems(list);
        setError("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los avisos.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial y cada 30 s
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-black">🔔 Avisos</h2>
        <button onClick={load} className="text-xs font-black text-orange-500">
          Actualizar
        </button>
      </div>
      <p className="mb-3 text-xs text-zinc-500">Las notificaciones que te llegan al celular, de la más nueva a la más vieja. Cuáles te llegan se elige en Resumen → Esta app.</p>
      {error && <p className="rounded-2xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      {!error && items === null && <p className="py-8 text-center text-sm text-zinc-500">Cargando avisos...</p>}
      {items && items.length === 0 && <p className="py-8 text-center text-sm text-zinc-500">Todavía no hay avisos.</p>}
      {items && items.length > 0 && (
        <ul className="divide-y divide-zinc-800">
          {items.map((n) => (
            <li
              key={n.id}
              className={`py-3 ${ORDER_ACTIONS.has(n.action) && n.entityId ? "cursor-pointer active:opacity-70" : ""}`}
              onClick={ORDER_ACTIONS.has(n.action) && n.entityId ? () => setOpen(n) : undefined}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-black">{n.title}</p>
                <span className="shrink-0 text-[11px] text-zinc-500">{when(n.at)}</span>
              </div>
              <p className="mt-0.5 text-sm text-zinc-300">{n.body}</p>
              <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                <span>{n.by ? `Por ${n.by}` : ""}</span>
                {ORDER_ACTIONS.has(n.action) && n.entityId ? (
                  <span className="font-black text-orange-500">Ver pedido →</span>
                ) : (
                  !n.url.startsWith("/dueno") && (
                    <Link href={n.url} className="font-black text-orange-500">
                      Ver detalle →
                    </Link>
                  )
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {open && <OrderSheet item={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
