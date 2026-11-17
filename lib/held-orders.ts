/**
 * Agregar productos a una cuenta abierta (mesa o cuenta en espera): lo nuevo
 * va como otra ronda. Lo que ya estaba queda marcado como preparado (no se
 * vuelve a mostrar en cocina), el total crece y la cuenta vuelve a cocina
 * como nueva solo con lo de esta ronda. El inventario de la ronda se descuenta
 * aparte como "<id>-r<ronda>".
 */
type Line = { price: number; quantity: number; round?: number; kdsDone?: boolean };
type OpenOrder<I extends Line> = {
  items: I[];
  rounds?: number;
  details: { discount?: number; deliveryFee?: number };
};

export function appendRoundToOrder<I extends Line, O extends OpenOrder<I>>(order: O, cart: I[]) {
  const round = (order.rounds || 1) + 1;
  const newItems = cart.map((item) => ({ ...item, round }));
  const items = [...order.items.map((item) => ({ ...item, kdsDone: true })), ...newItems];
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const updated = {
    ...order,
    items,
    subtotal,
    total: Math.max(0, subtotal - (order.details.discount || 0)) + (order.details.deliveryFee || 0),
    rounds: round,
    kdsCompleted: false,
    kdsCompletedAt: undefined,
    status: "Nuevo",
  };
  return { updated, newItems, round, inventoryId: (id: string | number) => `${id}-r${round}` };
}
