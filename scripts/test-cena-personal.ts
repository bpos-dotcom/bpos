/**
 * Prueba de la cena del personal: días que le tocan, una cena al día (con el
 * día que empieza de madrugada), deshacer, tope, qué puede elegir, inventario
 * con su motivo, comprobante corto, aviso al dueño y que NO cuente como venta.
 *   npx tsx scripts/test-cena-personal.ts
 */
export {};

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

async function main() {
  const sm = await import("@/lib/staff-meals");
  const { pushMessage } = await import("@/lib/push/rules");
  const { saleTicket, buildSaleTickets, paysCash } = await import("@/lib/bridge/sale-tickets");
  const { applyInventoryForOrder, getKardex, revertInventoryForOrder } = await import("@/lib/inventory");
  const { buildReport } = await import("@/lib/reports");

  const config = sm.normalizeConfig({
    enabled: true,
    people: [
      { id: "a", name: "Abdiel", days: [1, 2, 3, 4, 5], active: true },
      { id: "b", name: "Yuri", days: [0, 6], active: true },
      { id: "c", name: "Baja", days: [0, 1, 2, 3, 4, 5, 6], active: false },
      { id: "d", name: "Checa", userId: 7, days: [0, 1, 2, 3, 4, 5, 6], active: true },
    ],
    categories: ["Burgers", "Papas"],
    blockedProducts: [9],
    maxItems: 2,
    maxValue: 150,
    dayStartHour: 5,
    requireClockIn: true,
  });

  // --- configuración
  check("normaliza la config", config.people.length === 4 && config.dayStartHour === 5 && config.maxItems === 2);
  check("sin nombre no entra", sm.normalizeConfig({ people: [{ id: "x", name: "  ", days: [], active: true }] }).people.length === 0);
  check("hora de inicio se limita a 0-12", sm.normalizeConfig({ dayStartHour: 30 }).dayStartHour === 12);
  check("apagada por defecto", sm.normalizeConfig(null).enabled === false);

  // --- el día de la cena (lunes 16 nov 2026)
  const mon2230 = new Date(2026, 10, 16, 22, 30);
  const tue0030 = new Date(2026, 10, 17, 0, 30); // madrugada: todavía cuenta como lunes
  const tue0600 = new Date(2026, 10, 17, 6, 0);
  check("día: 12:30 a.m. cuenta como el día anterior", sm.mealDay(tue0030, 5) === "2026-11-16");
  check("día: 6 a.m. ya es el día nuevo", sm.mealDay(tue0600, 5) === "2026-11-17");
  check("día de la semana con madrugada", sm.mealWeekday(tue0030, 5) === 1);

  const clocked = (id: number) => id === 7;
  const notClocked = () => false;
  const A = config.people[0];
  const B = config.people[1];
  check("en turno el lunes", sm.personStatus(A, [], config, mon2230, clocked).kind === "ok");
  const off = sm.personStatus(B, [], config, mon2230, clocked);
  check("no le toca el lunes → No está en turno hoy", off.kind === "off" && off.reason === "No está en turno hoy", off);
  const inactive = sm.personStatus(config.people[2], [], config, mon2230, clocked);
  check("sin cena → gris", inactive.kind === "off" && inactive.reason === "Sin cena");
  const noClock = sm.personStatus(config.people[3], [], config, mon2230, notClocked);
  check("pide checar entrada", noClock.kind === "off" && noClock.reason === "No ha checado entrada");
  check("con entrada checada sí puede", sm.personStatus(config.people[3], [], config, mon2230, clocked).kind === "ok");

  // --- una cena al día
  const items = [{ id: 1, name: "Hamburguesa", price: 80, quantity: 1, category: "Burgers", station: "Parrilla" }];
  const meal = sm.buildStaffMealOrder({ id: 10, person: A, items, by: "Caja", now: mon2230, sequence: { localOrderNumber: 33, shiftSessionId: "s1" } });
  check("pedido de cena: total $0, ya pagado, con quién", meal.total === 0 && meal.subtotal === 0 && Boolean(meal.paidAt) && meal.staffMeal.name === "Abdiel" && meal.details.orderType === sm.STAFF_MEAL_TYPE);
  check("es cena del personal", sm.isStaffMeal(meal) && !sm.isStaffMeal({ id: 1 }));
  const used = sm.personStatus(A, [meal], config, tue0030, clocked);
  check("ya usó su cena (aunque sea de madrugada)", used.kind === "used");
  check("al día siguiente vuelve a tener", sm.personStatus(A, [meal], config, tue0600, clocked).kind === "ok");
  const undone = sm.undoStaffMeal(meal, "error", "Admin");
  check("deshecha: puede volver a marcar", (undone as { cancelled?: boolean }).cancelled === true && sm.personStatus(A, [undone], config, mon2230, clocked).kind === "ok");
  check("la cena de otro no le cuenta", sm.personStatus(config.people[3], [meal], config, mon2230, clocked).kind === "ok");

  // --- qué puede elegir y tope
  check("categoría permitida", sm.productAllowed({ id: 1, category: "Burgers", price: 80 }, config));
  check("categoría no permitida", !sm.productAllowed({ id: 2, category: "Bebidas", price: 30 }, config));
  check("producto bloqueado", !sm.productAllowed({ id: 9, category: "Burgers", price: 80 }, config));
  check("sin categorías = todo", sm.productAllowed({ id: 2, category: "Bebidas", price: 30 }, { categories: [], blockedProducts: [] }));
  check("tope de piezas", sm.capProblem([{ price: 10, quantity: 3 }], config).includes("2 productos"));
  check("tope de dinero", sm.capProblem([{ price: 160, quantity: 1 }], config).includes("$150.00"));
  check("dentro del tope", sm.capProblem([{ price: 70, quantity: 2 }], config) === "");
  check("sin tope", sm.capProblem([{ price: 999, quantity: 9 }], { maxItems: 0, maxValue: 0 }) === "");

  // --- tickets: comandas normales y comprobante corto sin precios ni QR, sin cajón
  const ticket = saleTicket(meal);
  check("comanda dice CENA PERSONAL y el nombre", ticket.platform === "CENA PERSONAL · Abdiel");
  check("sin forma de pago", ticket.payment === undefined);
  check("no abre el cajón", !paysCash(meal));
  const tickets = await buildSaleTickets(meal, { stations: ["Parrilla"], customer: true });
  const comprobante = tickets.find((t) => t.target === "Caja");
  check("sale comanda de Parrilla", tickets.some((t) => t.target === "Parrilla"));
  check("comprobante corto", Boolean(comprobante && comprobante.html.includes("CENA DEL PERSONAL") && comprobante.html.includes("Abdiel") && comprobante.html.includes("sin costo")));
  check("comprobante sin precios ni QR", Boolean(comprobante && !comprobante.html.includes("$80") && !comprobante.html.includes("<svg") && !comprobante.html.includes("TOTAL")));
  check("comprobante no abre cajón", comprobante?.drawer === false);

  // --- inventario: descuenta con su motivo y se puede regresar
  store.set("bpos_inventory", JSON.stringify([{ id: 100, name: "Pan", unit: "pza", stock: 10, minStock: 0 }]));
  store.set("bpos_recipes", JSON.stringify([{ id: 1, productId: 1, ingredientId: 100, quantity: 1 }]));
  const res = applyInventoryForOrder({ id: 10, items, source: "POS", staffMeal: { name: "Abdiel" } });
  const inv = () => JSON.parse(store.get("bpos_inventory") || "[]")[0]?.stock;
  check("descuenta inventario", res.success && inv() === 9, { res, stock: inv() });
  check("motivo: Cena del personal", getKardex().some((m) => String(m.reason).startsWith("Cena del personal #10 · Abdiel")));
  revertInventoryForOrder({ id: 10, items, staffMeal: { name: "Abdiel" } }, "regresar", "error");
  check("deshacer regresa el inventario", inv() === 10, inv());

  // --- aviso al dueño
  const push = pushMessage({ event_id: "e1", action: "staff_meal.created", description: "Abdiel marcó su cena", metadata: { name: "Abdiel", cost: 48 } }, {});
  check("aviso al dueño con nombre y costo", Boolean(push && push.title.includes("Cena del personal") && push.title.includes("Abdiel") && push.title.includes("$48")), push);
  check("se puede apagar", pushMessage({ event_id: "e2", action: "staff_meal.created", description: "", metadata: {} }, { cenaPersonal: false }) === null);
  check("aviso al deshacer", Boolean(pushMessage({ event_id: "e3", action: "staff_meal.cancelled", description: "", metadata: { name: "Abdiel" } }, {})));

  // --- no es venta
  const sale = { id: 11, createdAt: mon2230.toISOString(), items, details: { orderType: "Mostrador", paymentMethod: "Efectivo", discount: 0 }, subtotal: 80, total: 80, paidAt: mon2230.toISOString() };
  const report = buildReport(
    { orders: [sale, { ...meal, items: [{ ...items[0], price: 80 }] }] as never, products: [], recipes: [], costHistory: [], purchases: [], shifts: [], inventory: [], kardex: [] } as never,
    { from: new Date(2026, 10, 16), to: new Date(2026, 10, 18) }
  );
  check("reportes: la cena no cuenta como venta", report.orders.length === 1 && report.orders[0].id === 11, report.orders.map((o) => o.id));

  console.log(`\n${ok} bien, ${bad} con falla`);
  if (bad) process.exit(1);
}

void main();
