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
  const dos = dm.normalizeDigitalMenu({ hours: { days: [1, 2, 3, 4, 5], from: "13:30", to: "23:30" }, moreHours: [{ days: [0, 6], from: "12:00", to: "00:00" }] });
  check("dos horarios: viernes 14:00 abierto", dm.isOpenNow(dos, new Date("2026-10-30T14:00:00")));
  check("dos horarios: sábado 12:30 abierto", dm.isOpenNow(dos, new Date("2026-10-31T12:30:00")));
  check("dos horarios: sábado 11:00 cerrado", !dm.isOpenNow(dos, new Date("2026-10-31T11:00:00")));
  check("dos horarios: viernes 12:00 cerrado", !dm.isOpenNow(dos, new Date("2026-10-30T12:00:00")));
  check("dos horarios: texto", dm.openHoursLabel(dos).includes("Sáb"), dm.openHoursLabel(dos));
  const bp = dm.normalizeDigitalMenu({ hours: { days: [0, 1, 2, 3, 4], from: "13:30", to: "23:30" }, moreHours: [{ days: [5, 6], from: "13:30", to: "00:30" }] });
  check("texto público rangos", dm.publicHoursLabel(bp) === "Dom a Jue 1:30 pm a 11:30 pm · Vie y Sáb 1:30 pm a 12:30 am", dm.publicHoursLabel(bp));
  check("texto público todos los días", dm.publicHoursLabel(dm.normalizeDigitalMenu({ hours: { days: [], from: "09:00", to: "21:00" } })) === "Todos los días 9:00 am a 9:00 pm");
  check("abre en 2 h 30 min", dm.opensInLabel(bp, new Date("2026-11-03T11:00:00")) === "en 2 h 30 min", dm.opensInLabel(bp, new Date("2026-11-03T11:00:00")));
  check("abre mañana", dm.opensInLabel(bp, new Date("2026-11-03T23:45:00")).startsWith("mañana a la"), dm.opensInLabel(bp, new Date("2026-11-03T23:45:00")));
  check("abierto: sin próximo", dm.nextOpening(bp, new Date("2026-11-03T15:00:00")) === null);
  check("servicio los 7 días con dos bloques", dm.opensEveryDay(bp));
  check("solo viernes no es todos los días", !dm.opensEveryDay(horario));
  check("sin horario: siempre abierto", dm.isOpenNow(dm.normalizeDigitalMenu({ moreHours: [] }), new Date("2026-10-30T03:00:00")));

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
  check("WhatsApp al repartidor con 52", driverWhatsappLink({ id: "r", name: "Luis", phone: "8711112222", active: true }, sale).startsWith("https://api.whatsapp.com/send/?phone=528711112222&text="));
  check("número mal escrito no arma liga", driverWhatsappLink({ id: "r", name: "Luis", phone: "123", active: true }, sale) === "");


  // Confirmar manual: el mensaje se puede copiar aunque el número esté mal escrito
  const oo = await import("@/lib/online-orders");
  const badPhone = { id: "x", folio: "K6B4", token: "t", status: "nuevo", data: { type: "Domicilio", customer: { name: "Paloma ramirez", phone: "528717876" }, scheduledFor: "2026-11-15T20:30:00", lines: [] }, sale_order_id: null, eta_minutes: null, reason: null, created_at: "", updated_at: "" } as unknown as import("@/lib/online-orders").OnlineOrder;
  const conf = oo.scheduledConfirmText(badPhone);
  check("confirmación programada con nombre y folio", conf.startsWith("¡Hola Paloma!") && conf.includes("K6B4"), conf);
  check("número mal escrito: no hay liga de WhatsApp", oo.customerWhatsappLink(badPhone, "aceptado") === "");
  check("número mal escrito: el aviso sí se puede copiar", oo.customerNoticeText(badPhone, "aceptado").includes("K6B4"));
  const goodPhone = { ...badPhone, data: { ...badPhone.data, customer: { name: "Paloma", phone: "8717178766" } } } as typeof badPhone;
  check("número bien: la liga lleva el mismo texto", decodeURIComponent(oo.customerWhatsappLink(goodPhone, "listo")).includes(oo.customerNoticeText(goodPhone, "listo").slice(0, 20)));
  let rejected = false;
  try {
    await oo.updateOnlineCustomerPhone(badPhone, "12345");
  } catch {
    rejected = true;
  }
  check("editar número: rechaza números incompletos", rejected);

  // Programado: hora elegida para mandarlo a cocina
  const due = Date.parse("2026-11-15T20:30:00");
  check("sin hora elegida: X min antes según el menú", dm.kitchenTime({ scheduledFor: "2026-11-15T20:30:00" }, 30) === due - 30 * 60000);
  check("con hora elegida: esa hora", dm.kitchenTime({ scheduledFor: "2026-11-15T20:30:00", kitchenAt: new Date(due - 15 * 60000).toISOString() }, 30) === due - 15 * 60000);
  check("todavía no toca si la hora elegida no llega", dm.scheduledLater({ scheduledFor: "2026-11-15T20:30:00", kitchenAt: new Date(due - 15 * 60000).toISOString() }, 30, due - 20 * 60000));
  check("ya toca al llegar la hora elegida", !dm.scheduledLater({ scheduledFor: "2026-11-15T20:30:00", kitchenAt: new Date(due - 15 * 60000).toISOString() }, 30, due - 14 * 60000));
  check("hora después de la entrega: no", oo.checkKitchenAt(badPhone, new Date(due + 60000), due - 3600000) !== "");
  check("hora que ya pasó: no", oo.checkKitchenAt(badPhone, new Date(due - 7200000), due - 3600000) !== "");
  check("hora válida: sí", oo.checkKitchenAt(badPhone, new Date(due - 15 * 60000), due - 3600000) === "");

  // Ventana de pedido nuevo (en cualquier pantalla), también los programados
  const pop = await import("@/lib/online-orders-popup");
  const nowMs = due - 5 * 3600000;
  const prog = { id: "p1", folio: "K6B4", data: { ...badPhone.data, deliveryQuote: true, total: 232 } } as unknown as { id: string; folio: string; data: import("@/lib/digital-menu").OnlineOrderData };
  const normal = { id: "n1", folio: "A1B2", data: { type: "Recoger", customer: { name: "Luis", phone: "" }, lines: [], total: 99 } } as unknown as typeof prog;
  pop.announceNew([prog, normal], nowMs);
  const shown = pop.popupOrders([prog, normal], 30, nowMs);
  check("sale la ventana con el programado y el normal", shown.length === 2);
  check("el programado dice para cuándo y que falta el envío", shown[0].later && shown[0].quote && shown[0].scheduled !== "");
  pop.dismissPopup(["p1"], nowMs);
  check("Enterado: ya no sale ese pedido", pop.popupOrders([prog, normal], 30, nowMs).map((o) => o.id).join() === "n1");
  pop.announceNew([prog, normal], nowMs + 1000);
  check("no vuelve a salir aunque se revise otra vez", pop.popupOrders([prog, normal], 30, nowMs + 1000).map((o) => o.id).join() === "n1");
  check("si ya no está esperando, no sale", pop.popupOrders([], 30, nowMs).length === 0);

  // Modificar pedido: quitar lo agotado, con motivo, y recalcular el cobro
  const editData = {
    type: "Domicilio", customer: { name: "Paloma ramirez", phone: "8717178766" }, payment: "Efectivo", note: "",
    lines: [
      { productId: 10, name: "Hamburguesa Si Racha", quantity: 1, unitPrice: 79, picks: {}, summary: "" },
      { productId: 11, name: "Aros de Cebolla", quantity: 2, unitPrice: 49, picks: {}, summary: "" },
      { productId: 12, name: "Boneless Orden Individual", quantity: 1, unitPrice: 104, picks: {}, summary: "" },
    ],
    subtotal: 281, deliveryFee: 40, coupon: { code: "X", discount: 20 }, total: 301,
  } as unknown as import("@/lib/digital-menu").OnlineOrderData;
  const edited = oo.applyOrderEdit(editData, [1, 1, 0], "Agotado", "Caja");
  check("quita el renglón y baja la cantidad", edited.lines.length === 2 && edited.lines[1].quantity === 1);
  check("recalcula subtotal y total (con envío y cupón)", edited.subtotal === 128 && edited.total === 148, { s: edited.subtotal, t: edited.total });
  check("anota el cambio con lo quitado y el motivo", edited.edits?.length === 1 && edited.edits[0].removed.map((r) => r.name + r.quantity).join() === "Aros de Cebolla1,Boneless Orden Individual1" && edited.edits[0].totalBefore === 301 && edited.edits[0].totalAfter === 148);
  const msg = oo.editNoticeText({ folio: "K6B4", data: edited }, edited.edits![0]);
  check("mensaje al cliente con lo quitado y su nuevo total", msg.includes("K6B4") && msg.includes("1 × Boneless Orden Individual") && msg.includes("se nos agotó") && msg.includes("$148.00"), msg);
  const other = oo.applyOrderEdit(editData, [0, 2, 1], "No hay pan", "");
  check("motivo escrito (Otro)", other.edits![0].reason === "No hay pan" && oo.editNoticeText({ folio: "K6B4", data: other }, other.edits![0]).includes("No hay pan"));
  const cheap = oo.applyOrderEdit({ ...editData, coupon: { code: "X", discount: 100 } }, [1, 0, 0], "Agotado");
  check("el cupón no puede ser mayor que lo que queda", cheap.coupon?.discount === 79 && cheap.total === 40);
  const throws = (fn: () => unknown) => { try { fn(); return false; } catch { return true; } };
  check("sin motivo no se guarda", throws(() => oo.applyOrderEdit(editData, [1, 1, 0], "  ")));
  check("sin quitar nada no se guarda", throws(() => oo.applyOrderEdit(editData, [1, 2, 1], "Agotado")));
  check("si se quita todo, mejor rechazar", throws(() => oo.applyOrderEdit(editData, [0, 0, 0], "Agotado")));
  check("no deja subir cantidades", oo.applyOrderEdit(editData, [5, 1, 1], "Agotado").lines[0].quantity === 1);
  const asOrder = (data: unknown, status = "nuevo") => ({ status, data }) as unknown as import("@/lib/online-orders").OnlineOrder;
  check("se puede modificar si es nuevo", oo.editBlocked(asOrder(editData)) === "");
  check("rechazado ya no", oo.editBlocked(asOrder(editData, "rechazado")) !== "");
  check("pagado en línea no (hay que devolver el pago)", oo.editBlocked(asOrder({ ...editData, payment: "Mercado Pago", mp: { status: "approved", paymentId: "1", amount: 301, paidAt: "" } })) !== "");

  // Pedido ya aceptado: la venta de la caja baja esas piezas con sus precios
  const cartBefore = [
    { id: 10, name: "Hamburguesa", price: 79, quantity: 1, lineId: "10" },
    { id: 11, name: "Aros", price: 49, quantity: 2, lineId: "11" },
    { id: 12, name: "Boneless", price: 104, quantity: 1, lineId: "12|m" },
  ] as unknown as import("@/components/CartPanel").CartItem[];
  const cartAfter = [cartBefore[0], { ...cartBefore[1], quantity: 1 }] as typeof cartBefore;
  const saleIn = { items: cartBefore.map((x) => ({ ...x })), subtotal: 281, total: 301, deliveryFee: 40, details: { discount: 20 } } as unknown as Parameters<typeof oo.saleAfterEdit>[0];
  const se = oo.saleAfterEdit(saleIn, cartBefore, cartAfter);
  check("venta: quita el boneless y un aro", se.sale.items.length === 2 && se.sale.items[1].quantity === 1 && se.removed.map((r) => r.name + r.quantity).join() === "Aros1,Boneless1");
  check("venta: total nuevo con envío y descuento", se.sale.subtotal === 128 && se.sale.total === 148, se.sale);
  const none = oo.saleAfterEdit(saleIn, cartBefore, cartBefore);
  check("venta: sin cambios no quita nada", none.removed.length === 0 && none.sale.total === 301);
  check("aceptado sí se puede modificar; entregado no", oo.editBlocked(asOrder(editData, "aceptado")) === "" && oo.editBlocked(asOrder(editData, "entregado")) !== "");
  const rules = await import("@/lib/push/rules");
  const pm = rules.pushMessage({ event_id: "e", action: "online_order.edit", description: "x", metadata: { total: 148, before: 301 } }, null);
  check("aviso al dueño del pedido modificado", Boolean(pm && pm.title.includes("Pedido modificado") && pm.title.includes("$301") && pm.title.includes("$148")), pm);
  check("acción en la lista de avisos", rules.PUSH_ACTIONS.has("online_order.edit") && rules.PUSH_ACTIONS.has("sale.item.removed"));

  console.log(`\n${ok} bien, ${bad} mal`);
  process.exit(bad ? 1 : 0);
}

void main();
