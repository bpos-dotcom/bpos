import { Product } from "@/data/products";

export type CartItem = Product & {
  quantity: number;
};

type CartPanelProps = {
  items: CartItem[];
  discount: number;
  canCheckout: boolean;
  validationMessage: string;
  onIncrease: (id: number) => void;
  onDecrease: (id: number) => void;
  onClear: () => void;
  onCheckout: () => void;
};

export function CartPanel({
  items,
  discount,
  canCheckout,
  validationMessage,
  onIncrease,
  onDecrease,
  onClear,
  onCheckout,
}: CartPanelProps) {
  const subtotal = items.reduce(
    (total, item) => total + item.price * item.quantity,
    0
  );

  const total = Math.max(subtotal - discount, 0);

  return (
    <aside className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
      <h2 className="text-xl font-black text-orange-500">🛒 Pedido actual</h2>

      <div className="mt-5 space-y-3">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
            Agrega productos al pedido
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="rounded-2xl border border-zinc-800 bg-black p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-bold">
                    {item.quantity} × {item.name}
                  </p>
                  <p className="text-sm text-zinc-400">
                    ${item.price.toFixed(2)} c/u
                  </p>
                  <p className="mt-1 text-xs text-orange-400">
                    👨‍🍳 {item.station || "Cocina"}
                  </p>
                </div>

                <p className="font-black text-orange-500">
                  ${(item.price * item.quantity).toFixed(2)}
                </p>
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => onDecrease(item.id)}
                  className="h-9 w-9 rounded-xl bg-zinc-800 font-black"
                >
                  -
                </button>

                <button
                  onClick={() => onIncrease(item.id)}
                  className="h-9 w-9 rounded-xl bg-orange-500 font-black text-black"
                >
                  +
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-6 space-y-3 border-t border-zinc-800 pt-6">
        <div className="flex justify-between">
          <span className="text-zinc-400">Subtotal</span>
          <span className="font-black">${subtotal.toFixed(2)}</span>
        </div>

        {discount > 0 && (
          <div className="flex justify-between">
            <span className="text-zinc-400">Descuento autorizado</span>
            <span className="font-black text-red-400">
              -${discount.toFixed(2)}
            </span>
          </div>
        )}

        <div className="flex justify-between border-t border-zinc-800 pt-4">
          <span className="text-zinc-400">Total</span>
          <span className="text-3xl font-black text-orange-500">
            ${total.toFixed(2)}
          </span>
        </div>

        <button
          onClick={onCheckout}
          disabled={!canCheckout}
          className="mt-5 w-full rounded-2xl bg-orange-500 py-4 font-black text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          Abrir cobro
        </button>

        {!canCheckout && (
          <p className="text-center text-xs text-zinc-500">
            {validationMessage}
          </p>
        )}

        <button
          onClick={onClear}
          disabled={items.length === 0}
          className="w-full rounded-2xl border border-red-500/40 bg-red-500/10 py-4 font-black text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Limpiar pedido
        </button>

        <p className="text-center text-xs text-zinc-600">
          Limpiar pedido requiere autorización Admin.
        </p>
      </div>
    </aside>
  );
}