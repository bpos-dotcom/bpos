/**
 * Cuentas del mensaje del corte de caja (WhatsApp y correo):
 *  - Totales: lo local (efectivo, tarjeta, transferencia, pago en línea), lo
 *    que depositarán las apps (aprox., según su comisión) y la suma de ambos.
 *  - Ventas por canal: TODOS los tipos de pedido del turno (mostrador, mesa,
 *    para llevar, domicilio, menú en línea, apps…), para que sumen el total.
 */

type CutOrder = { total: number; details: { orderType?: string } };

const CHANNEL_ICON: Record<string, string> = {
  Mostrador: "🏪",
  "Para llevar": "🥡",
  Mesa: "🍽️",
  Domicilio: "🏠",
  WhatsApp: "📱",
  "Uber Eats": "🍔",
  "Didi Food": "🛵",
  Rappi: "🛵",
  Kiosco: "🖥️",
};

/** Ventas por tipo de pedido, de mayor a menor; los canales sin ventas no salen */
export function salesByChannel(orders: CutOrder[]) {
  const map = new Map<string, number>();
  for (const order of orders) {
    const channel = order.details.orderType?.trim() || "Mostrador";
    map.set(channel, (map.get(channel) || 0) + (Number(order.total) || 0));
  }
  return [...map]
    .filter(([, total]) => total !== 0)
    .map(([channel, total]) => ({ channel, total }))
    .sort((a, b) => b.total - a.total);
}

export function channelsText(orders: CutOrder[]) {
  const rows = salesByChannel(orders);
  if (!rows.length) return "Sin ventas.";
  return rows.map((r) => `${CHANNEL_ICON[r.channel] || (/kiosco/i.test(r.channel) ? "🖥️" : "🧾")} ${r.channel}: $${r.total.toFixed(2)}`).join("\n");
}

/**
 * Renglones de totales.
 * @param totalSales  todas las ventas del turno
 * @param platformSales  lo que cobraron las apps (no entra a caja)
 * @param deposits  depósito aprox. por app (null = sin comisión configurada)
 */
export function cutTotalsText(totalSales: number, platformSales: number, deposits: { sales: number; deposit: number | null }[]) {
  const money = (n: number) => `$${n.toFixed(2)}`;
  const local = totalSales - platformSales;
  if (!platformSales) return `📈 Total ventas: ${money(totalSales)}`;
  const known = deposits.filter((d) => d.deposit !== null);
  if (!known.length) {
    return `🏪 Total ventas locales: ${money(local)}\n🛵 Ventas de apps: ${money(platformSales)}\n📈 Total ventas: ${money(totalSales)}`;
  }
  const depositTotal = known.reduce((sum, d) => sum + (d.deposit || 0), 0);
  const missing = deposits.length > known.length;
  return (
    `🏪 Total ventas locales: ${money(local)}\n` +
    `🛵 Depósitos aprox. de apps: ${money(depositTotal)}${missing ? " (sin contar las apps sin comisión configurada)" : ""}\n` +
    `📈 Total (locales + depósitos): ${money(local + depositTotal)}`
  );
}
