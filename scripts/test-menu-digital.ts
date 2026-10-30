/**
 * Prueba del menú digital: agotados (hoy / indefinido), ocultos, opciones
 * enlazadas a productos agotados, horario y cómo un pedido en línea se
 * vuelve venta con los precios de B-POS (no los que mandó el cliente).
 *   npx tsx scripts/test-menu-digital.ts
 */
import type { Product } from "@/data/products";

// localStorage del navegador para las funciones de B-POS
const store = new Map<string, string>();
const g = globalThis as unknown as { window: unknown; localStorage: unknown; CustomEvent: unknown };
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};
g.window = { dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined };
g.CustomEvent = class {
  constructor(public type: string, public init?: unknown) {}
};

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

const products: Product[] = [
  {
    id: 1,
    name: "Combo Burger",
    category: "Combos",
    price: 159,
    emoji: "🍔",
    station: "Parrilla",
    noOwnTicket: true,
    modifierGroups: [
      { key: "b", name: "Hamburguesa", min: 1, max: 1, included: 1, extraPrice: 0, options: [{ key: "b1", name: "Burger", productId: 2 }] },
      { key: "r", name: "Refresco", min: 1, max: 1, included: 1, extraPrice: 0, options: [{ key: "r1", name: "Coca", productId: 3 }, { key: "r2", name: "Sprite", productId: 4 }] },
      { key: "s", name: "Salsas", min: 0, max: 0, included: 1, extraPrice: 10, options: [{ key: "s1", name: "BBQ" }, { key: "s2", name: "Ranch" }] },
    ],
  },
  { id: 2, name: "Burger", category: "Burgers", price: 99, emoji: "🍔", station: "Parrilla" },
  { id: 3, name: "Coca", category: "Bebidas", price: 30, emoji: "🥤", station: "Barra" },
  { id: 4, name: "Sprite", category: "Bebidas", price: 30, emoji: "🥤", station: "Barra" },
  { id: 5, name: "Papas", category: "Extras", price: 45, emoji: "🍟", station: "Freidora" },
];

async function main() {
  const dm = await import("@/lib/digital-menu");
  const { buildOnlineCart } = await import("@/lib/online-orders");
  store.set("bpos_products", JSON.stringify(products));

  // Agotados
  const now = new Date("2026-10-30T15:00:00");
  const menu = dm.normalizeDigitalMenu({
    soldOut: {
      "3": { until: null, at: "x" },
      "5": { until: new Date("2026-10-30T23:59:59").toISOString(), at: "x" },
    },
    hidden: [4],
  });
  check("agotado indefinido sigue agotado", dm.isSoldOut(menu, 3, now));
  check("agotado hoy está agotado hoy", dm.isSoldOut(menu, 5, now));
  check("agotado hoy vuelve mañana", !dm.isSoldOut(menu, 5, new Date("2026-10-31T09:00:00")));
  check("oculto no se ve", !dm.isAvailableOnline(menu, products[3], now));
  check("disponible se ve", dm.isAvailableOnline(menu, products[1], now));
  check("fin de hoy es hoy a las 23:59", new Date(dm.endOfToday(now)).getHours() === 23);

  // Coca agotada: el combo solo ofrece Sprite (oculto no quita opción del combo)
  const { groups, blocked } = dm.onlineGroups(products[0], products, menu, now);
  const refresco = groups.find((x) => x.key === "r")!;
  check("opción enlazada agotada se quita", refresco.options.map((o) => o.key).join() === "r2", refresco.options);
  check("combo sigue disponible", !blocked);
  const sinRefresco = dm.normalizeDigitalMenu({ soldOut: { "3": { until: null, at: "x" }, "4": { until: null, at: "x" } } });
  check("grupo obligatorio sin opciones bloquea el producto", dm.onlineGroups(products[0], products, sinRefresco, now).blocked);

  // Horario
  const horario = dm.normalizeDigitalMenu({ hours: { days: [5], from: "13:00", to: "22:00" } });
  check("viernes 15:00 abierto", dm.isOpenNow(horario, new Date("2026-10-30T15:00:00")));
  check("viernes 23:00 cerrado", !dm.isOpenNow(horario, new Date("2026-10-30T23:00:00")));
  check("sábado cerrado", !dm.isOpenNow(horario, new Date("2026-10-31T15:00:00")));

  // Liga
  check("liga sugerida", dm.suggestSlug("Burger Planet Lerdo!") === "burger-planet-lerdo");
  check("liga válida", dm.SLUG_RE.test("burger-planet") && !dm.SLUG_RE.test("-mal") && !dm.SLUG_RE.test("ab"));

  // Pedido → venta con precios de B-POS
  store.set("bpos_digital_menu", JSON.stringify({ soldOut: {}, hidden: [] }));
  const order: import("@/lib/digital-menu").OnlineOrderData = {
    type: "Recoger",
    customer: { name: "Ana", phone: "8710000000", address: "", reference: "" },
    payment: "Efectivo",
    note: "",
    lines: [
      // el cliente "manda" un precio falso: B-POS usa el suyo
      { productId: 1, name: "Combo Burger", quantity: 2, unitPrice: 1, picks: { __producto: { r: ["r2"], s: ["s1", "s2"] } }, summary: "", comment: "sin cebolla" },
      { productId: 5, name: "Papas", quantity: 1, unitPrice: 45, picks: {}, summary: "" },
      { productId: 99, name: "Borrado", quantity: 1, unitPrice: 10, picks: {}, summary: "" },
    ],
    subtotal: 0,
    deliveryFee: 0,
    total: 0,
  };
  const { cart, subtotal, problems } = buildOnlineCart(order);
  const combo = cart.find((c) => c.id === 1)!;
  check("2 renglones válidos", cart.length === 2, cart.map((c) => c.name));
  check("combo con salsa extra cobra $169", combo.price === 169, combo.price);
  check("combo cantidad 2", combo.quantity === 2);
  check("combo lleva Burger y Sprite como partes", (combo.parts || []).map((p) => p.name).sort().join() === "Burger,Sprite", combo.parts);
  check("comentario llega a cocina", combo.comment === "sin cebolla");
  check("subtotal con precios de B-POS", subtotal === 169 * 2 + 45, subtotal);
  check("avisa el producto que ya no existe", problems.some((p) => p.includes("Borrado")), problems);

  store.set("bpos_digital_menu", JSON.stringify({ soldOut: { "5": { until: null, at: "x" } }, hidden: [] }));
  check("avisa si se agotó después de pedir", buildOnlineCart(order).problems.some((p) => p.includes("Papas")));

  // Formas de pago por tipo de pedido
  const legacy = dm.normalizeDigitalMenu({ payments: { cash: true, card: false, transfer: true } });
  check("sin configurar usa las formas de antes", legacy.paymentsByType.Domicilio.join() === "Efectivo,Transferencia", legacy.paymentsByType);
  const byType = dm.normalizeDigitalMenu({ paymentsByType: { Recoger: ["Efectivo", "Tarjeta"], Domicilio: ["Transferencia", "Bitcoin"], Mesa: [] } as never });
  check("domicilio solo lo permitido (sin formas inventadas)", byType.paymentsByType.Domicilio.join() === "Transferencia", byType.paymentsByType);
  check("mesa sin formas de pago", byType.paymentsByType.Mesa.length === 0);

  // Mensaje al repartidor
  const { driverMessage, driverWhatsappLink } = await import("@/lib/drivers");
  const info = {
    title: "Folio 73A8",
    businessName: "Burger Planet",
    customer: { name: "Ana", phone: "8710000000", address: "Madero 364", reference: "Casa azul", mapsUrl: "https://maps.google.com/?q=25.5,-103.5" },
    lines: [{ quantity: 2, name: "Planet Burger", detail: "sin cebolla" }],
    total: 229,
  };
  const cobrar = driverMessage({ ...info, payment: { paid: false, method: "Efectivo", amount: 229, cashWith: 500 } });
  check("repartidor: cuánto cobrar", cobrar.includes("COBRAR $229.00"), cobrar);
  check("repartidor: cambio que lleva", cobrar.includes("$271.00 de cambio"), cobrar);
  check("repartidor: liga de Maps", cobrar.includes("https://maps.google.com/?q=25.5,-103.5"));
  check("repartidor: lo que se pidió", cobrar.includes("2 × Planet Burger (sin cebolla)"));
  const pagado = driverMessage({ ...info, payment: { paid: true, method: "Transferencia" } });
  check("repartidor: ya pagado no cobra", pagado.includes("YA PAGADO") && !pagado.includes("COBRAR"), pagado);
  const sale = { ...info, payment: { paid: true as const, method: "Efectivo" } };
  check("WhatsApp al repartidor con 52", driverWhatsappLink({ id: "r", name: "Luis", phone: "8711112222", active: true }, sale).startsWith("https://wa.me/528711112222?text="));
  check("número mal escrito no arma liga", driverWhatsappLink({ id: "r", name: "Luis", phone: "123", active: true }, sale) === "");


  console.log(`\n${ok} bien, ${bad} mal`);
  process.exit(bad ? 1 : 0);
}

void main();
