/**
 * Combos de delivery con "¿Deseas agregar algún extra?" obligatorio y su
 * "No, Gracias": Didi y Uber no imprimen nada cuando el cliente no quiere
 * extra. Ese silencio es "No, gracias", no una opción que falta.
 *   npx tsx scripts/test-combo-sin-extra.ts
 */
export {};

const store = new Map<string, string>();
const localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};
const g = globalThis as unknown as Record<string, unknown>;
g.localStorage = localStorage;
g.window = { localStorage, setInterval: () => 0, clearInterval: () => undefined, setTimeout: () => 0, dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined };
g.CustomEvent = class {
  constructor(public type: string, public init?: unknown) {}
};
g.Event = class {
  constructor(public type: string) {}
};

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

async function main() {
  const sale = await import("../lib/bridge/create-automatic-sale");
  const ops = await import("../lib/notifications/operationsCenter");

  const extras = {
    key: "ex",
    name: "Deseas agregar algun extra?",
    min: 1,
    max: 0,
    included: 1,
    extraPrice: 0,
    options: [
      { key: "no", name: "No, Gracias" },
      { key: "carne", name: "Carne Extra", productId: 61, extraPrice: 25 },
      { key: "tocino", name: "Tocino Extra", productId: 66, extraPrice: 15 },
    ],
  };
  const burger = { id: 47, name: "Hamburguesa Mexicana", category: "Burgers", price: 79, emoji: "🍔", modifierGroups: [extras] };
  const combo = {
    id: 90,
    name: "Combo El Favorito",
    category: "Combos",
    price: 150,
    emoji: "🍔",
    modifierGroups: [{ key: "hb", name: "Elige tu hamburguesa", min: 1, max: 1, included: 1, extraPrice: 0, options: [{ key: "a", name: "Hamburguesa Mexicana", productId: 47 }, { key: "b", name: "Hamburguesa Polaca", productId: 51 }] }],
  };
  const catalog = [
    burger,
    combo,
    { id: 61, name: "Carne Extra", category: "Extras", price: 25, emoji: "🥩" },
    { id: 66, name: "Tocino Extra", category: "Extras", price: 15, emoji: "🥓" },
    { id: 51, name: "Hamburguesa Polaca", category: "Burgers", price: 79, emoji: "🍔" },
  ] as never[];
  const ticket = (choices: { name: string }[]) =>
    ({ kind: "delivery", platform: "Uber Eats", orderId: "6DD4B", customer: null, receivedAt: "", charges: [], total: 98, items: [{ index: 0, qty: 1, name: "La Mexicana", price: 140, notes: [], choices: choices.map((c) => ({ qty: 1, price: 0, question: "", ...c })), pending: false, stations: ["Parrilla"] }] }) as never;
  const line = { sourceIndex: 0, externalName: "La Mexicana", compound: true };

  // --- Opción "no quiero" ---
  check("'No, Gracias' es la opción de no", sale.declineOption(extras as never)?.key === "no");
  check("'Sin extra' también", sale.declineOption({ ...extras, options: [{ key: "s", name: "Sin extra" }] } as never)?.key === "s");
  check("'Ninguno' también", sale.declineOption({ ...extras, options: [{ key: "n", name: "Ninguno" }] } as never)?.key === "n");
  check("'Nachos' no es 'no'", !sale.declineOption({ ...extras, options: [{ key: "n", name: "Nachos" }] } as never));
  check("opción con producto no cuenta como 'no'", !sale.declineOption({ ...extras, options: [{ key: "n", name: "No, Gracias", productId: 3 }] } as never));

  // --- Uber/Didi sin nada en el ticket: es "No, gracias" ---
  const sinNada = sale.deliverySelection(burger as never, catalog, ticket([]), line);
  check("ticket sin extra: no avisa", !("missingChoices" in sinNada), sinNada);
  check("ticket sin extra: queda 'No, Gracias'", (sinNada.modifiers || []).some((m) => m.name === "No, Gracias" && m.group === extras.name), sinNada);

  // --- Si pidió extra, se respeta ---
  const conTocino = sale.deliverySelection(burger as never, catalog, ticket([{ name: "Tocino Extra" }]), line);
  check("con tocino: no avisa", !("missingChoices" in conTocino), conTocino);
  check("con tocino: va el tocino y no el 'No, Gracias'", (conTocino.parts || []).some((p) => p.name.includes("Tocino")) && !(conTocino.modifiers || []).some((m) => m.name === "No, Gracias"), conTocino);

  // --- Un combo que de verdad no dice qué hamburguesa: sigue avisando ---
  const comboSinHamburguesa = sale.deliverySelection(combo as never, catalog, ticket([]), line);
  check("combo sin decir la hamburguesa: sí avisa", (comboSinHamburguesa.missingChoices || []).includes("Elige tu hamburguesa"), comboSinHamburguesa);

  // --- Alertas que ya existían: se limpian solas ---
  localStorage.setItem("bpos_products", JSON.stringify(catalog));
  localStorage.setItem(
    "bpos_orders",
    JSON.stringify([
      { id: 707, items: [{ ...burger, quantity: 1, missingChoices: [extras.name] }], total: 79, details: {} },
      { id: 708, items: [{ ...combo, quantity: 1, missingChoices: ["Elige tu hamburguesa"] }], total: 150, details: {} },
    ])
  );
  ops.upsertOperationsAlert({ id: "bridge-combo:707", priority: "warning", title: "Combo sin opción obligatoria", message: "x", source: "Bridge", moduleHref: "/bridge", metadata: { orderId: 707 } });
  ops.upsertOperationsAlert({ id: "bridge-combo:708", priority: "warning", title: "Combo sin opción obligatoria", message: "y", source: "Bridge", moduleHref: "/bridge", metadata: { orderId: 708 } });
  const cleared = sale.clearDeclinedComboAlerts("Gerardo");
  const alerts = ops.getOperationsAlerts();
  const orders = JSON.parse(localStorage.getItem("bpos_orders") || "[]");
  check("limpia una alerta (la del extra)", cleared === 1, cleared);
  check("alerta del extra: resuelta", alerts.find((a) => a.id === "bridge-combo:707")?.status === "resolved", alerts);
  check("alerta del combo de verdad: sigue abierta", alerts.find((a) => a.id === "bridge-combo:708")?.status !== "resolved", alerts);
  check("venta 707: sin aviso y con 'No, Gracias'", !orders[0].items[0].missingChoices && orders[0].items[0].modifiers?.[0]?.name === "No, Gracias", orders[0].items[0]);
  check("venta 708 no cambia", orders[1].items[0].missingChoices?.[0] === "Elige tu hamburguesa");
  check("segunda vez no hace nada", sale.clearDeclinedComboAlerts() === 0);

  console.log(`\n${ok} bien, ${bad} mal`);
  if (bad) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
