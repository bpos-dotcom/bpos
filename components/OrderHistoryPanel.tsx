import { CartItem } from "@/components/CartPanel";
import { OrderDetails } from "@/components/OrderDetailsPanel";

export type SavedOrder = {
  id: number;
  createdAt: string;
  items: CartItem[];
  details: OrderDetails;
  subtotal: number;
  total: number;
};

type OrderHistoryPanelProps = {
  orders: SavedOrder[];
  userRole: "Admin" | "Cajero";
  onDelete: (id: number) => void;
  onPrint: (order: SavedOrder) => void;
  onWhatsapp: (order: SavedOrder) => void;
};

export function OrderHistoryPanel({
  orders,
  userRole,
  onDelete,
  onPrint,
  onWhatsapp,
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
                    {order.details.customerName || "Mostrador"} ·{" "}
                    {order.details.orderType} · {order.details.paymentMethod}
                  </p>

                  <div className="mt-3 text-sm text-zinc-500">
                    {order.items.map((item) => (
                      <p key={item.id}>
                        {item.quantity} × {item.name}
                      </p>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col items-start gap-2 lg:items-end">
                  <p className="text-2xl font-black text-orange-500">
                    ${order.total.toFixed(2)}
                  </p>

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

                    {userRole === "Admin" && (
                      <button
                        onClick={() => onDelete(order.id)}
                        className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-black text-red-400"
                      >
                        Borrar
                      </button>
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