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
  return (
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
  );
}

/** Botones rápidos para cobrar: exacto y los billetes que cubren el total. */
export function cashQuickAmounts(total: number) {
  const amounts = [{ label: "Exacto", value: Math.round(total * 100) / 100 }];
  for (const bill of [50, 100, 200, 500, 1000]) {
    const value = Math.ceil(total / bill) * bill;
    if (value > total && !amounts.some((a) => a.value === value) && amounts.length < 4) amounts.push({ label: `$${value}`, value });
  }
  return amounts;
}
