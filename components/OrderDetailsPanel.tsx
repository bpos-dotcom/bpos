export type OrderDetails = {
  orderType: string;
  customerName: string;
  customerPhone: string;
  /** Se captura al cobrar cuando el pedido es a domicilio */
  customerAddress: string;
  /** Se elige al cobrar */
  paymentMethod: string;
  /** Se captura al cobrar (cupón, club o autorizado) */
  discount: number;
  /** Cupón con el que se hizo el descuento */
  couponCode?: string;
  /** Costo de envío a domicilio (se suma al total) */
  deliveryFee?: number;
  /** Cuánto se pagó con cada método (pago mixto o cuenta dividida); sin propina */
  payments?: Record<string, number>;
  /** Pedido de mesa (comer aquí): la mesa elegida y cuántas personas */
  table?: { id: string; name: string; zone: string };
  diners?: number;
};

type OrderDetailsPanelProps = {
  details: OrderDetails;
  onChange: (details: OrderDetails) => void;
};

const input = "w-full rounded-xl border border-zinc-800 bg-black px-3 py-2 text-sm text-white placeholder:text-zinc-600";

/** Una barra con tipo, cliente y WhatsApp. El pago, el descuento y la dirección se piden al cobrar. */
export function OrderDetailsPanel({
  details,
  onChange,
}: OrderDetailsPanelProps) {
  function updateField(key: keyof OrderDetails, value: string | number) {
    const next = { ...details, [key]: value };
    // Si deja de ser pedido de mesa, se suelta la mesa
    if (key === "orderType" && value !== "Mesa") {
      delete next.table;
      delete next.diners;
    }
    onChange(next);
  }

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="grid grid-cols-3 gap-2">
        <Field label="Tipo de pedido">
          <select
            value={details.orderType}
            onChange={(event) => updateField("orderType", event.target.value)}
            className={input}
          >
            <option>Mostrador</option>
            {details.table && <option>Mesa</option>}
            <option>Para llevar</option>
            <option>Domicilio</option>
            <option>WhatsApp</option>
            <option>Didi Food</option>
            <option>Uber Eats</option>
          </select>
        </Field>

        <Field label="Cliente">
          <input
            value={details.customerName}
            onChange={(event) =>
              updateField("customerName", event.target.value)
            }
            placeholder="Nombre"
            className={input}
          />
        </Field>

        <Field label="WhatsApp">
          <input
            value={details.customerPhone}
            onChange={(event) =>
              updateField("customerPhone", event.target.value)
            }
            placeholder="10 dígitos"
            className={input}
          />
        </Field>
      </div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-bold text-zinc-400">
        {label}
      </span>
      {children}
    </label>
  );
}
