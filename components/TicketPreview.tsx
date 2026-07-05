import { SavedOrder } from "@/components/OrderHistoryPanel";

type TicketPreviewProps = {
  order: SavedOrder;
};

export function TicketPreview({ order }: TicketPreviewProps) {
  return (
    <div className="w-[320px] rounded-2xl bg-white p-5 font-mono text-sm text-black">
      <div className="text-center">
        <p className="text-xl font-black">BURGER PLANET</p>
        <p>Ticket #{order.id.toString().padStart(6, "0")}</p>
        <p>{new Date(order.createdAt).toLocaleString()}</p>
      </div>

      <hr className="my-4 border-dashed border-black" />

      <p>Cliente: {order.details.customerName || "Mostrador"}</p>
      <p>Tipo: {order.details.orderType}</p>
      <p>Pago: {order.details.paymentMethod}</p>

      <hr className="my-4 border-dashed border-black" />

      {order.items.map((item) => (
        <div key={item.id} className="flex justify-between gap-4">
          <span>
            {item.quantity} x {item.name}
          </span>
          <span>${(item.price * item.quantity).toFixed(2)}</span>
        </div>
      ))}

      <hr className="my-4 border-dashed border-black" />

      <div className="flex justify-between">
        <span>Subtotal</span>
        <span>${order.subtotal.toFixed(2)}</span>
      </div>

      <div className="flex justify-between">
        <span>Descuento</span>
        <span>-${order.details.discount.toFixed(2)}</span>
      </div>

      <div className="mt-2 flex justify-between text-lg font-black">
        <span>TOTAL</span>
        <span>${order.total.toFixed(2)}</span>
      </div>

      <hr className="my-4 border-dashed border-black" />

      <p className="text-center">Gracias por tu compra 🚀</p>
      <p className="text-center">WhatsApp: 5631820373</p>
    </div>
  );
}