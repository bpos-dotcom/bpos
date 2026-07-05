export type OrderDetails = {
  orderType: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  paymentMethod: string;
  discount: number;
};

type OrderDetailsPanelProps = {
  details: OrderDetails;
  onChange: (details: OrderDetails) => void;
};

export function OrderDetailsPanel({
  details,
  onChange,
}: OrderDetailsPanelProps) {
  function updateField(key: keyof OrderDetails, value: string | number) {
    onChange({
      ...details,
      [key]: value,
    });
  }

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
      <h2 className="text-xl font-black">Detalles del pedido</h2>

      <div className="mt-6 space-y-4">
        <Field label="Tipo de pedido">
          <select
            value={details.orderType}
            onChange={(event) => updateField("orderType", event.target.value)}
            className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
          >
            <option>Mostrador</option>
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
            placeholder="Nombre del cliente"
            className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white placeholder:text-zinc-600"
          />
        </Field>

        <Field label="WhatsApp">
          <input
            value={details.customerPhone}
            onChange={(event) =>
              updateField("customerPhone", event.target.value)
            }
            placeholder="Ej. 5631820373"
            className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white placeholder:text-zinc-600"
          />
        </Field>

        <Field label="Dirección / referencia">
          <textarea
            value={details.customerAddress}
            onChange={(event) =>
              updateField("customerAddress", event.target.value)
            }
            placeholder="Solo si es domicilio"
            className="min-h-24 w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white placeholder:text-zinc-600"
          />
        </Field>

        <Field label="Método de pago">
          <select
            value={details.paymentMethod}
            onChange={(event) =>
              updateField("paymentMethod", event.target.value)
            }
            className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
          >
            <option>Efectivo</option>
            <option>Tarjeta</option>
            <option>Transferencia</option>
            <option>Mixto</option>
          </select>
        </Field>

        <Field label="Descuento">
          <input
            type="number"
            min={0}
            value={details.discount}
            onChange={(event) =>
              updateField("discount", Number(event.target.value))
            }
            className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
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
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-zinc-400">
        {label}
      </span>
      {children}
    </label>
  );
}