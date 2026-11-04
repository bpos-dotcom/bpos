"use client";
import { useState } from "react";
import { CartItem } from "@/components/CartPanel";
import { realCustomerName } from "@/lib/bridge/delivery-ticket";
import { OrderDetails } from "@/components/OrderDetailsPanel";

export type SavedOrder = {
  id: number;
  createdAt: string;
  items: CartItem[];
  details: OrderDetails;
  subtotal: number;
  total: number;
  cancelled?: boolean;
  cancelReason?: string;
  /** A domicilio en espera: ya se prepara, se cobra cuando regrese el repartidor */
  pendingPayment?: boolean;
  paidAt?: string;
  /** Socio del club al que se le suma la venta cuando se cobre */
  clubAccountId?: string;
  /** Cuenta de mesa: rondas que se han mandado a cocina */
  rounds?: number;
  /** Propina (aparte del total de la venta) y con qué se pagó */
  tip?: number;
  tipPayments?: Record<string, number>;
  /** Cuenta dividida entre personas: lo que ya pagó cada quien (hasta completar el total) */
  partialPayments?: { amount: number; tip: number; method: string; payments: Record<string, number>; tipPayments: Record<string, number>; at: string; by?: string }[];
  /** Parte de una cuenta dividida por productos: de qué pedido salió */
  splitFrom?: number;
  /** Venta de delivery (DiDi, Uber, Rappi): la cobra la plataforma */
  externalPlatform?: string;
  externalOrderNumber?: string;
  /** Quién capturó la venta en el POS y quién la cobró (reportes por empleado y propinas) */
  soldBy?: string;
  paidBy?: string;
};

/** Filtro del historial: de dónde vino la venta */
export type SaleSource = "todos" | "local" | "uber" | "didi" | "rappi";
export const SALE_SOURCES: { key: SaleSource; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "local", label: "🏪 Local" },
  { key: "uber", label: "Uber Eats" },
  { key: "didi", label: "DiDi Food" },
  { key: "rappi", label: "Rappi" },
];
export function saleSource(order: Pick<SavedOrder, "externalPlatform">): Exclude<SaleSource, "todos"> {
  const p = String(order.externalPlatform || "").toLowerCase();
  if (p.includes("uber")) return "uber";
  if (p.includes("didi")) return "didi";
  if (p.includes("rappi")) return "rappi";
  return "local";
}

const SOURCE_LABEL: Record<Exclude<SaleSource, "todos">, string> = { local: "Local", uber: "Uber Eats", didi: "DiDi Food", rappi: "Rappi" };

/** Métodos a los que se puede cambiar una venta ya cobrada */
export const CHANGEABLE_METHODS = ["Efectivo", "Tarjeta", "Transferencia"];

type OrderHistoryPanelProps = {
  orders: SavedOrder[];
  userRole: "Admin" | "Cajero";
  onDelete: (id: number) => void;
  onPrint: (order: SavedOrder) => void;
  onWhatsapp: (order: SavedOrder) => void;
  /** Pedido en espera: ya pagó (con qué) */
  onMarkPaid?: (order: SavedOrder, method: string) => void;
  /** Se cobró con otro método del que se marcó (pide PIN de administrador) */
  onChangePayment?: (order: SavedOrder, method: string) => void | Promise<unknown>;
};

export function OrderHistoryPanel({
  orders,
  userRole,
  onDelete,
  onPrint,
  onWhatsapp,
  onMarkPaid,
  onChangePayment,
}: OrderHistoryPanelProps) {
  const [source, setSource] = useState<SaleSource>("todos");
  const [changing, setChanging] = useState<number | null>(null);
  const shown = source === "todos" ? orders : orders.filter((o) => saleSource(o) === source);
  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-black text-orange-500">
            🧾 Historial de pedidos
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Reimprime tickets, reenvía WhatsApp y consulta ventas.
          </p>
        </div>

        <p className="rounded-2xl border border-zinc-800 bg-black px-4 py-2 text-sm font-bold text-zinc-400">
          {shown.length} pedidos
        </p>
      </div>

      {/* De dónde vino la venta: local (mostrador, mesas, menú en línea) o cada plataforma */}
      <div className="mt-4 flex flex-wrap gap-2">
        {SALE_SOURCES.map((s) => (
          <button
            key={s.key}
            onClick={() => setSource(s.key)}
            className={`rounded-xl border px-3 py-1.5 text-sm font-black ${source === s.key ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-800 bg-black text-zinc-300 hover:border-orange-500"}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-3">
        {shown.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">
            {orders.length === 0 ? "Todavía no hay pedidos guardados." : "No hay pedidos de ese origen."}
          </div>
        ) : (
          shown.map((order) => (
            <div
              key={order.id}
              className="rounded-2xl border border-zinc-800 bg-black p-4"
            >
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]">
                <div>
                  {order.externalOrderNumber ? (
                    <>
                      <p className="font-black text-orange-300">
                        {SOURCE_LABEL[saleSource(order)]} · pedido #{order.externalOrderNumber}
                      </p>
                      <p className="text-sm font-bold text-zinc-400">Pedido #{order.id.toString().padStart(6, "0")}</p>
                    </>
                  ) : (
                    <p className="font-black">
                      Pedido #{order.id.toString().padStart(6, "0")}
                    </p>
                  )}

                  <p className="mt-1 text-sm text-zinc-400">
                    {new Date(order.createdAt).toLocaleString()}
                  </p>

                  <p className="mt-1 text-sm text-zinc-400">
                    {realCustomerName(order.details.customerName) || "Sin nombre"} ·{" "}
                    {order.details.orderType} · {order.details.paymentMethod}
                  </p>

                  <div className="mt-3 text-sm text-zinc-500">
                    {order.items.map((item, index) => (
                      <p key={`${item.id}-${index}`}>
                        {item.quantity} × {item.name}
                        {item.parts?.length ? <span className="text-zinc-600"> ({item.parts.map((p) => p.name).join(", ")})</span> : null}
                        {item.modifiers?.length ? <span className="text-zinc-600"> · {item.modifiers.map((m) => m.name).join(", ")}</span> : null}
                        {item.comment ? <span className="text-yellow-600"> · 💬 {item.comment}</span> : null}
                      </p>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col items-start gap-2 lg:items-end">
                  <p className="text-2xl font-black text-orange-500">
                    ${order.total.toFixed(2)}
                  </p>
                  {order.pendingPayment && !order.cancelled && (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-2">
                      <span className="text-sm font-black text-yellow-200">⏳ Cuenta en espera · por cobrar</span>
                      {onMarkPaid &&
                        ["Efectivo", "Transferencia", "Tarjeta"].map((m) => (
                          <button key={m} onClick={() => onMarkPaid(order, m)} className="rounded-lg bg-yellow-400 px-3 py-1 text-xs font-black text-black">
                            Ya pagó · {m}
                          </button>
                        ))}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => onPrint(order)}
                      className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2 text-sm font-black text-white hover:border-orange-500"
                    >
                      Imprimir
                    </button>

                    <button
                      onClick={() => onWhatsapp(order)}
                      className="rounded-xl bg-green-500 px-4 py-2 text-sm font-black text-black"
                    >
                      WhatsApp
                    </button>

                    {order.cancelled ? (
                      <span className="rounded-xl border border-red-500/40 px-4 py-2 text-sm font-black text-red-400">
                        Cancelada{order.cancelReason ? `: ${order.cancelReason}` : ""}
                      </span>
                    ) : (
                      <>
                        {/* Cobrada en el local con otro método del marcado: siempre con PIN de administrador */}
                        {onChangePayment && !order.pendingPayment && saleSource(order) === "local" && (
                          <button
                            onClick={() => setChanging(changing === order.id ? null : order.id)}
                            className="rounded-xl border border-yellow-500/40 bg-yellow-500/10 px-4 py-2 text-sm font-black text-yellow-300"
                          >
                            Cambiar pago
                          </button>
                        )}
                        {userRole === "Admin" && (
                          <button
                            onClick={() => onDelete(order.id)}
                            className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-black text-red-400"
                          >
                            Cancelar venta
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {changing === order.id && onChangePayment && (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-2">
                      <span className="text-xs font-bold text-yellow-200">En realidad se pagó con:</span>
                      {CHANGEABLE_METHODS.filter((m) => m !== order.details.paymentMethod).map((m) => (
                        <button
                          key={m}
                          onClick={() => {
                            setChanging(null);
                            void onChangePayment(order, m);
                          }}
                          className="rounded-lg bg-yellow-400 px-3 py-1 text-xs font-black text-black"
                        >
                          {m}
                        </button>
                      ))}
                      <button onClick={() => setChanging(null)} className="rounded-lg border border-zinc-700 px-3 py-1 text-xs font-bold text-zinc-300">
                        Cerrar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}