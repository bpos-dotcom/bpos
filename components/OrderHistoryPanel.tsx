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
};

type OrderHistoryPanelProps = {
  orders: SavedOrder[];
  userRole: "Admin" | "Cajero";
  onDelete: (id: number) => void;
  onPrint: (order: SavedOrder) => void;
  onWhatsapp: (order: SavedOrder) => void;
  /** Pedido en espera: ya pagó (con qué) */
  onMarkPaid?: (order: SavedOrder, method: string) => void;
};

export function OrderHistoryPanel({
  orders,
  userRole,
  onDelete,
  onPrint,
  onWhatsapp,
  onMarkPaid,
}: OrderHistoryPanelProps) {
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
          {orders.length} pedidos
        </p>
      </div>

      <div className="mt-6 space-y-3">
        {orders.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">
            Todavía no hay pedidos guardados.
          </div>
        ) : (
          orders.map((order) => (
            <div
              key={order.id}
              className="rounded-2xl border border-zinc-800 bg-black p-4"
            >
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]">
                <div>
                  <p className="font-black">
                    Pedido #{order.id.toString().padStart(6, "0")}
                  </p>

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
                      userRole === "Admin" && (
                        <button
                          onClick={() => onDelete(order.id)}
                          className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-black text-red-400"
                        >
                          Cancelar venta
                        </button>
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}