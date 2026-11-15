/**
 * Ventas cerradas sin la copia completa del producto (memoria llena en la caja).
 *   npx tsx scripts/test-ventas-ligeras.ts
 */
import { slimOrders, slimOrdersText } from "@/lib/order-slim";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}`);
};

const groups = Array.from({ length: 6 }, (_, g) => ({ id: g, name: `Grupo ${g}`, options: Array.from({ length: 15 }, (_, i) => ({ id: i, name: `Opción ${i} con nombre largo`, price: i })) }));
const item = (id: number) => ({
  id, name: "Boneless", price: 129, quantity: 1, station: "Freidora", emoji: "🍗", category: "Boneless",
  image: "https://x.supabase.co/storage/v1/object/public/bpos-media/abc/productos/123.webp",
  description: "Boneless bañados con salsa a elegir y papas", modifierGroups: groups, saleSchedule: { days: [5] },
  modifiers: [{ group: "Salsa", name: "BBQ", price: 0 }], parts: [{ name: "Papas" }], comment: "sin cebolla", packaging: [{ ingredientId: 1, quantity: 1 }],
});
const paid = { id: 1, total: 129, items: [item(1), item(2)], paymentMethod: "Tarjeta" };
const open = { id: 2, total: 129, items: [item(3)], pendingPayment: true };
const list = [paid, open];

const slim = slimOrders(list) as typeof list;
check("hay cambios", !!slim);
const s0 = slim[0].items[0] as Record<string, unknown>;
check("venta cobrada: sin grupos de opciones", !("modifierGroups" in s0));
check("venta cobrada: sin foto ni descripción", !("image" in s0) && !("description" in s0));
check("venta cobrada: conserva lo vendido (opciones elegidas, partes, comentario)", Array.isArray(s0.modifiers) && Array.isArray(s0.parts) && s0.comment === "sin cebolla");
check("venta cobrada: conserva precio, cantidad, estación y empaque", s0.price === 129 && s0.quantity === 1 && s0.station === "Freidora" && Array.isArray(s0.packaging));
check("venta cobrada: conserva total y forma de pago", slim[0].total === 129 && (slim[0] as typeof paid).paymentMethod === "Tarjeta");
check("cuenta abierta: se queda completa", "modifierGroups" in (slim[1].items[0] as Record<string, unknown>));
check("lo original no se modifica", "modifierGroups" in (list[0].items[0] as Record<string, unknown>));
const raw = JSON.stringify(list);
const slimRaw = slimOrdersText(raw);
check(`pesa mucho menos (${raw.length} → ${slimRaw.length})`, slimRaw.length < raw.length / 2);
check("ya aligerado: regresa el mismo texto", slimOrdersText(slimRaw) === slimRaw);
check("sin cambios: null", slimOrders(JSON.parse(slimRaw)) === null);
check("texto que no es lista: igual", slimOrdersText("{}") === "{}" && slimOrdersText("") === "" && slimOrdersText("[roto") === "[roto");

console.log(`\n${ok} bien, ${bad} mal`);
process.exit(bad ? 1 : 0);
