/**
 * Avisos que se llenaban solos en el Centro de Operaciones:
 *  - Combos de DiDi/Uber "sin opción obligatoria" cuando el ticket sí decía
 *    la opción a su manera, contestó "No, gracias" o cambió el refresco por
 *    uno cobrado aparte.
 *  - "Aumento de costo" que se resuelve con su motivo: una compra de
 *    emergencia no cambia el costo del insumo.
 *   npx tsx scripts/test-bridge-combos-costos.ts
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
g.window = { localStorage, setInterval: () => 0, clearInterval: () => undefined, setTimeout, dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined };
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
  const purchases = await import("../lib/purchases");
  const inventory = await import("../lib/inventory");
  const { makeCostLookup } = await import("../lib/reports");

  // ------------------------------------------------ nombres a la manera de la plataforma
  const especiales = [
    { key: "ny", name: "Hamburguesa NewYork BBQ" },
    { key: "nyd", name: "Hamburguesa NewYork Doble BBQ" },
    { key: "bb", name: "Boneless Burger" },
  ];
  check("'newyork (tocino, bbq y aros)' es la NewYork BBQ", sale.pickOptions(["newyork (tocino, bbq y aros)"], especiales, "Hamburguesa Especial")[0] === "ny");
  check("'newyork doble bbq' es la Doble", sale.pickOptions(["newyork doble bbq con aros"], especiales, "Hamburguesa Especial")[0] === "nyd");
  check("'newyork' solo es la sencilla, no la Doble", sale.pickOptions(["newyork"], especiales, "Hamburguesa Especial")[0] === "ny");
  const aderezos = [
    { key: "bbq", name: "Salsa BBQ" },
    { key: "buf", name: "Salsa Búfalo" },
    { key: "r", name: "Ranch" },
    { key: "br", name: "Búfalo Ranch" },
  ];
  check("'BBQ' es la Salsa BBQ (solo una opción la tiene)", sale.pickOptions(["BBQ"], aderezos, "aderezo a elegir?")[0] === "bbq");
  check("'Ranch' sigue siendo el Ranch", sale.pickOptions(["Ranch"], aderezos, "aderezo a elegir?")[0] === "r");
  check("'Si' no elige nada", sale.pickOptions(["Si"], aderezos, "aderezo a elegir?").length === 0);
  check("'Aderezo especial' no está en el combo: no se inventa", sale.pickOptions(["Aderezo especial"], aderezos, "aderezo a elegir?").length === 0);

  // ------------------------------------------------ combos
  const refrescos = { key: "ref", name: "Refresco Importado", min: 1, max: 1, included: 1, extraPrice: 0, options: [{ key: "dp", name: "Dr Pepper", productId: 22 }, { key: "mtn", name: "MTN DEW", productId: 23 }] };
  const clasico = {
    id: 5,
    name: "Combo Clasico BP",
    category: "Combos",
    price: 150,
    emoji: "🍔",
    modifierGroups: [{ key: "hb", name: "Hamburguesa Clásica BP", min: 1, max: 1, included: 1, extraPrice: 0, options: [{ key: "mx", name: "Hamburguesa Mexicana", productId: 47 }] }, refrescos],
  };
  const didi = { id: 90, name: "Combo Favorito (DIDI)", category: "Combos", price: 218, emoji: "🍔", modifierGroups: [{ ...refrescos, key: "beb", name: "Que tal una bebida" }] };
  const especial = { id: 91, name: "Combo Especial", category: "Combos", price: 189, emoji: "🍔", modifierGroups: [{ key: "he", name: "Hamburguesa Especial", min: 1, max: 1, included: 1, extraPrice: 0, options: [{ key: "ny", name: "Hamburguesa NewYork BBQ", productId: 53 }, { key: "nyd", name: "Hamburguesa NewYork Doble BBQ", productId: 55 }] }, refrescos] };
  const catalog = [
    clasico,
    didi,
    especial,
    { id: 47, name: "Hamburguesa Mexicana", category: "Burgers", price: 79, emoji: "🍔" },
    { id: 53, name: "Hamburguesa NewYork BBQ", category: "Burgers", price: 99, emoji: "🍔" },
    { id: 55, name: "Hamburguesa NewYork Doble BBQ", category: "Burgers", price: 129, emoji: "🍔" },
    { id: 22, name: "Dr Pepper", category: "Bebidas", price: 39, emoji: "🥤" },
    { id: 23, name: "MTN DEW", category: "Bebidas", price: 39, emoji: "🥤" },
    { id: 45, name: "Coca-Cola 600ml", category: "Bebidas", price: 30, emoji: "🥤" },
  ] as never[];
  const ticket = (name: string, choices: { name: string; question: string; price?: number }[]) =>
    ({ kind: "delivery", platform: "DiDi Food", orderId: "1", customer: null, receivedAt: "", charges: [], total: 100, items: [{ index: 0, qty: 1, name, price: 189, notes: [], choices: choices.map((c) => ({ qty: 1, price: 0, ...c })), pending: false, stations: ["Parrilla"] }] }) as never;

  const noGracias = sale.deliverySelection(didi as never, catalog, ticket("Combo- Combo El Favorito", [{ name: "No, Gracias", question: "Que tal una bebida?" }]), { externalName: "Combo- Combo El Favorito" });
  check("DiDi 'Que tal una bebida? → No, Gracias': no falta nada", !("missingChoices" in noGracias), noGracias);
  const sinNada = sale.deliverySelection(didi as never, catalog, ticket("Combo- Combo El Favorito", []), { externalName: "Combo- Combo El Favorito" });
  check("si el ticket no dice nada del refresco: sí avisa", (sinNada.missingChoices || []).includes("Que tal una bebida"), sinNada);
  const otraPregunta = sale.deliverySelection(clasico as never, catalog, ticket("Combo Especial", [{ name: "Hamburguesa Mexicana", question: "Elige tu hamburguesa" }, { name: "No, Gracias", question: "Deseas agregar extra?" }]), { externalName: "Combo Especial" });
  check("un 'No, Gracias' de otra pregunta no tapa el refresco", (otraPregunta.missingChoices || []).includes("Refresco Importado"), otraPregunta);

  const coca = ticket("Combo Especial", [{ name: "Hamburguesa Mexicana", question: "Elige tu hamburguesa especial" }, { name: "Refresco Coca Cola ORIGINAL 600ml", question: "Elige tu REF(SUJETO A DISPONIBLE)", price: 25 }]);
  const conCoca = sale.deliverySelection(clasico as never, catalog, coca, { externalName: "Combo Especial" }, [{ externalName: "Refresco Coca Cola ORIGINAL 600ml", category: "Bebidas" }]);
  check("refresco cambiado por Coca cobrada aparte: no falta el refresco", !("missingChoices" in conCoca), conCoca);
  check("y la hamburguesa sí va en el combo", (conCoca.parts || []).some((p) => p.name === "Hamburguesa Mexicana"), conCoca);
  const cocaSinVenta = sale.deliverySelection(clasico as never, catalog, coca, { externalName: "Combo Especial" });
  check("si la Coca no se vendió aparte: sí avisa", (cocaSinVenta.missingChoices || []).includes("Refresco Importado"), cocaSinVenta);
  const otraCategoria = sale.deliverySelection(clasico as never, catalog, coca, { externalName: "Combo Especial" }, [{ externalName: "Refresco Coca Cola ORIGINAL 600ml", category: "Postres" }]);
  check("algo vendido aparte de otra categoría no tapa el refresco", (otraCategoria.missingChoices || []).includes("Refresco Importado"), otraCategoria);

  const ny = sale.deliverySelection(especial as never, catalog, ticket("Combo el mas Especial", [{ name: "newyork (tocino, bbq y aros)", question: "Elige tu hamburguesa mas especial" }, { name: "Dr Pepper", question: "Elige tu REF" }]), { externalName: "Combo el mas Especial" });
  check("Combo Especial con 'newyork (tocino, bbq y aros)': completo", !("missingChoices" in ny) && (ny.parts || []).some((p) => p.name === "Hamburguesa NewYork BBQ"), ny);

  // ------------------------------------------------ avisos viejos: se vuelven a leer solos
  localStorage.setItem("bpos_products", JSON.stringify(catalog));
  const comboItem = (p: { id: number; name: string; category: string; price: number }, externalName: string, missing: string[]) => ({ id: p.id, name: p.name, category: p.category, price: p.price, quantity: 1, externalName, missingChoices: missing });
  localStorage.setItem(
    "bpos_orders",
    JSON.stringify([
      { id: 800, items: [comboItem(especial, "Combo el mas Especial", ["Hamburguesa Especial"])], total: 189, details: {}, deliveryTicket: ticket("Combo el mas Especial", [{ name: "newyork (tocino, bbq y aros)", question: "Elige tu hamburguesa mas especial" }, { name: "Dr Pepper", question: "Elige tu REF" }]) },
      { id: 751, items: [comboItem(clasico, "Combo Especial", ["Refresco Importado"]), { id: 45, name: "Coca-Cola 600ml", category: "Bebidas", price: 30, quantity: 1, externalName: "Refresco Coca Cola ORIGINAL 600ml" }], total: 214, details: {}, deliveryTicket: coca },
      { id: 814, items: [comboItem(didi, "Combo- Combo El Favorito", ["Que tal una bebida"])], total: 218, details: {}, deliveryTicket: ticket("Combo- Combo El Favorito", [{ name: "No, Gracias", question: "Que tal una bebida?" }]) },
      { id: 657, items: [comboItem(clasico, "Combo- Combo El Favorito", ["Hamburguesa Clásica BP", "Refresco Importado"])], total: 218, details: {}, deliveryTicket: ticket("Combo- Combo El Favorito", [{ name: "No, Gracias", question: "Que tal una bebida?" }]) },
    ])
  );
  for (const id of [800, 751, 814, 657]) ops.upsertOperationsAlert({ id: `bridge-combo:${id}`, priority: "warning", title: "Combo sin opción obligatoria", message: String(id), source: "Bridge", moduleHref: "/bridge", metadata: { orderId: id } });
  const cleared = sale.recheckComboAlerts("Gerardo");
  const alerts = ops.getOperationsAlerts();
  const orders = JSON.parse(localStorage.getItem("bpos_orders") || "[]");
  const status = (id: number) => alerts.find((a) => a.id === `bridge-combo:${id}`)?.status;
  check("se resuelven solos los 3 que ahora sí se entienden", cleared === 3, cleared);
  check("800 (newyork), 751 (Coca aparte), 814 (No, gracias): resueltos", status(800) === "resolved" && status(751) === "resolved" && status(814) === "resolved", alerts);
  check("657 (de verdad no dice la hamburguesa): sigue abierto", status(657) !== "resolved");
  check("la venta 800 ya lleva la NewYork BBQ", orders[0].items[0].parts?.some((p: { name: string }) => p.name === "Hamburguesa NewYork BBQ") && !orders[0].items[0].missingChoices, orders[0].items[0]);
  check("la venta 751 conserva la Coca aparte", orders[1].items.length === 2 && !orders[1].items[0].missingChoices, orders[1].items);
  check("segunda vez no hace nada", sale.recheckComboAlerts() === 0);
  ops.reopenOperationsAlert("bridge-combo:800");
  check("aviso abierto de una venta que ya está completa: se resuelve", sale.recheckComboAlerts() === 1 && ops.getOperationsAlerts().find((a) => a.id === "bridge-combo:800")?.status === "resolved");

  // ------------------------------------------------ aumento de costo con motivo
  const later = () => new Promise((r) => setTimeout(r, 5));
  const pan = { ingredientId: 7, ingredientName: "Pan brioche", unit: "pza" as const };
  purchases.setManualCost({ ...pan, packages: 1, perPackage: 10, total: 70.6 }); // 7.06
  await later();
  await later();
  const caro = purchases.setManualCost({ ...pan, packages: 1, perPackage: 10, total: 78.3 }); // 7.83 (+10.9%)
  const alertId = `manual-cost:${caro.id}`;
  check("compra más cara: avisa", ops.getOperationsAlerts().some((a) => a.id === alertId && a.title === "Aumento de costo"));
  check("antes de resolver, el costo es el nuevo", Math.abs((purchases.getLatestIngredientCost(7)?.unitCost || 0) - 7.83) < 0.001);
  check("encuentra el registro de la alerta", purchases.costRecordForAlert(alertId)?.id === caro.id);
  purchases.resolveCostRaise(alertId, "emergencia", "se acabó en la noche", "Gerardo");
  const resolved = ops.getOperationsAlerts().find((a) => a.id === alertId);
  check("se resuelve con el motivo en la nota", resolved?.status === "resolved" && /Compra de emergencia/.test(resolved.resolutionNote || "") && /7\.06/.test(resolved.resolutionNote || "") && /se acabó/.test(resolved.resolutionNote || ""), resolved);
  check("el costo del insumo se queda en 7.06", Math.abs((purchases.getLatestIngredientCost(7)?.unitCost || 0) - 7.06) < 0.001);
  check("inventario (mermas) también usa 7.06", Math.abs(inventory.latestUnitCost(7) - 7.06) < 0.001);
  check("food cost también usa 7.06", Math.abs(makeCostLookup(purchases.getIngredientCostHistory())(7) - 7.06) < 0.001);
  check("la compra sigue en el historial (el gasto sí cuenta)", purchases.getIngredientCostHistory().some((c) => c.id === caro.id && c.occasional && c.occasionalReason === "Compra de emergencia"));
  await later();
  const normal = purchases.setManualCost({ ...pan, packages: 1, perPackage: 10, total: 71 }); // 7.10 vs 7.06: sin aviso
  check("la siguiente compra normal se compara con 7.06 (no avisa)", !ops.getOperationsAlerts().some((a) => a.id === `manual-cost:${normal.id}`));

  await later();
  const caro2 = purchases.setManualCost({ ...pan, packages: 1, perPackage: 10, total: 85 }); // 8.50
  purchases.resolveCostRaise(`manual-cost:${caro2.id}`, "subio");
  check("'Sí subió de precio': el costo nuevo se queda", Math.abs((purchases.getLatestIngredientCost(7)?.unitCost || 0) - 8.5) < 0.001);
  check("compra de una compra (purchase-cost) también se encuentra", (() => {
    localStorage.setItem("bpos_ingredient_cost_history", JSON.stringify([...purchases.getIngredientCostHistory(), { id: "c1", ingredientId: 9, ingredientName: "Tomate", supplier: "x", purchaseId: "purchase-1-ab", purchasedAt: new Date().toISOString(), inventoryQuantity: 1, total: 40, unitCost: 40 }]));
    return purchases.costRecordForAlert("purchase-cost:purchase-1-ab:9")?.id === "c1";
  })());
  let threw = false;
  try {
    purchases.resolveCostRaise(alertId, "cualquiera" as never);
  } catch {
    threw = true;
  }
  check("motivo inventado no se acepta", threw);

  console.log(`\n${ok} bien, ${bad} mal`);
  if (bad) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
