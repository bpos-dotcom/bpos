/**
 * Agregar productos a una cuenta en espera (o mesa): lo nuevo va como otra
 * ronda, solo eso a cocina, el total crece y el inventario de la ronda se
 * descuenta aparte.
 *   npx tsx scripts/test-agregar-a-cuenta-en-espera.ts
 */
import { appendRoundToOrder } from "@/lib/held-orders";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` -> ${JSON.stringify(extra)}` : ""}`);
};

type Item = { id: number; name: string; price: number; quantity: number; round?: number; kdsDone?: boolean };
const order = {
  id: 15,
  pendingPayment: true,
  status: "Listo",
  kdsCompleted: true,
  items: [{ id: 1, name: "Boneless Burger", price: 89, quantity: 1 }] as Item[],
  subtotal: 89,
  total: 89,
  details: { orderType: "Mostrador", discount: 0 },
};

const a = appendRoundToOrder<Item, typeof order>(order, [{ id: 2, name: "Salchipapas", price: 65, quantity: 1 }, { id: 3, name: "Refresco", price: 20, quantity: 1 }]);
check("ronda 2", a.round === 2 && a.updated.rounds === 2);
check("total sube a 174", a.updated.total === 174 && a.updated.subtotal === 174, a.updated.total);
check("lo que ya estaba no regresa a cocina", a.updated.items[0].kdsDone === true);
check("lo nuevo sí va a cocina con su ronda", a.newItems.length === 2 && a.newItems.every((i) => i.round === 2 && !i.kdsDone));
check("la cuenta vuelve a cocina como nueva", a.updated.status === "Nuevo" && a.updated.kdsCompleted === false);
check("sigue por cobrar", a.updated.pendingPayment === true);
check("inventario de la ronda aparte", a.inventoryId(order.id) === "15-r2");
check("no cambia la cuenta original", order.items.length === 1 && order.total === 89);

const b = appendRoundToOrder<Item, typeof order>(a.updated, [{ id: 4, name: "Galletas", price: 30, quantity: 2 }]);
check("otra vez: ronda 3", b.round === 3 && b.inventoryId(15) === "15-r3");
check("otra vez: total 234", b.updated.total === 234, b.updated.total);
check("otra vez: todo lo anterior marcado como preparado", b.updated.items.slice(0, 3).every((i) => i.kdsDone));

const withDiscount = appendRoundToOrder<Item, typeof order & { details: { deliveryFee: number } }>({ ...order, details: { ...order.details, discount: 10, deliveryFee: 25 } }, [{ id: 2, name: "Salchipapas", price: 65, quantity: 1 }]);
check("respeta descuento y envío", withDiscount.updated.total === 89 + 65 - 10 + 25, withDiscount.updated.total);

console.log(`\n${ok} bien, ${bad} con falla`);
if (bad) process.exit(1);
