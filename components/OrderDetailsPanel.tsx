export type OrderDetails = {
  orderType: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  paymentMethod: string;
  discount: number;
  /** Cupón con el que se hizo el descuento */
  couponCode?: string;
};

type OrderDetailsPanelProps = {
  details: OrderDetails;
  onChange: (details: OrderDetails) => void;
};

const input = "w-full rounded-xl border border-zinc-800 bg-black px-3 py-2 text-sm text-white placeholder:text-zinc-600";

/** Datos del pedido, compactos: van debajo del pedido actual (dos campos por renglón). */
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

  // La dirección solo estorba si no es a domicilio
  const showAddress = details.orderType === "Domicilio" || Boolean(details.customerAddress);

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-4">
      <h2 className="text-base font-black">Detalles del pedido</h2>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Field label="Tipo de pedido">
          <select
            value={details.orderType}
            onChange={(event) => updateField("orderType", event.target.value)}
            className={input}
          >
            <option>Mostrador</option>
            <option>Para llevar</option>
            <option>Domicilio</option>
            <option>WhatsApp</option>
            <option>Didi Food</option>
            <option>Uber Eats</option>
          </select>
        </Field>

        <Field label="Método de pago">
          <select
            value={details.paymentMethod}
            onChange={(event) =>
              updateField("paymentMethod", event.target.value)
            }
            className={input}
          >
            <option>Efectivo</option>
            <option>Tarjeta</option>
            <option>Transferencia</option>
            <option>Mixto</option>
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
            placeholder="Ej. 5631820373"
            className={input}
          />
        </Field>

        {showAddress && (
          <Field label="Dirección / referencia" wide>
            <textarea
              value={details.customerAddress}
              onChange={(event) =>
                updateField("customerAddress", event.target.value)
              }
              placeholder="Calle, número y referencia"
              rows={2}
              className={input}
            />
          </Field>
        )}

        <Field label="Descuento">
          <input
            type="number"
            min={0}
            value={details.discount}
            onChange={(event) =>
              updateField("discount", Number(event.target.value))
            }
            className={input}
          />
        </Field>
      </div>
    </section>
  );
}

function Field({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${wide ? "col-span-2" : ""}`}>
      <span className="mb-1 block text-xs font-bold text-zinc-400">
        {label}
      </span>
      {children}
    </label>
  );
}
