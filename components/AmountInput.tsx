"use client";
/**
 * Campo de monto. Con "pantalla táctil" (Configuración → Punto de venta) el
 * teclado en pantalla (TouchKeyboard) lo abre con sus botones rápidos.
 */
type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Botones rápidos del teclado en pantalla (ej. el total exacto y billetes) */
  quick?: { label: string; value: number }[];
  className?: string;
};

export function AmountInput({ label, value, onChange, quick = [], className = "" }: Props) {
  const current = Number(value);
  return (
    <div>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="0"
        aria-label={label}
        data-keypad-label={label}
        data-quick={quick.length ? JSON.stringify(quick) : undefined}
        className={className}
      />
      {/* Botones rápidos siempre a la vista (sin esperar al teclado en pantalla): exacto y billetes */}
      {quick.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {quick.map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => onChange(String(q.value))}
              className={`rounded-xl border px-3 py-2 text-sm font-black ${current === q.value ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-700 bg-zinc-900 text-white hover:border-orange-500"}`}
            >
              {q.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Botones rápidos para cobrar: exacto y los billetes que cubren el total. */
export function cashQuickAmounts(total: number) {
  const amounts = [{ label: "Exacto", value: Math.round(total * 100) / 100 }];
  // Con cada billete, el múltiplo que cubre el total (cobrar $15: $20, $50, $100, $200, $500)
  for (const bill of [20, 50, 100, 200, 500, 1000]) {
    const value = Math.ceil(total / bill) * bill;
    if (value > total && !amounts.some((a) => a.value === value) && amounts.length < 6) amounts.push({ label: `$${value}`, value });
  }
  return amounts;
}
