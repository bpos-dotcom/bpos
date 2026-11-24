/**
 * Opciones de DiDi/Uber que no existen igual en B-POS:
 *  - "No, Gracias" (a cualquier pregunta, aunque no se llame como el grupo):
 *    no se descuenta nada y no avisa.
 *  - Lo que el ticket elige y es un producto del POS (igual o claramente
 *    parecido): se vende y descuenta, aunque no sea opción del combo.
 *  - Si no se entiende (o se parece a dos), sí avisa: no se adivina.
 * Casos de pedidos reales de nov 2026 (DiDi #12, Uber 4PZAS).
 *   npx tsx scripts/test-bridge-opciones.ts
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

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

async function main() {
  const sale = await import("../lib/bridge/create-automatic-sale");
  const { interpretOrder, saysNo, similarProduct } = await import("../lib/bridge/interpret-order");
  const { prepareSalePayload } = await import("../lib/bridge/prepare-sale");

  // ------------------------------------------------ piezas
  check("'No, Gracias' es un no", saysNo("No, Gracias") && saysNo("Sin refresco") && saysNo("Nada") && saysNo("Ninguno"));
  check("'Nopal' y 'Sincronizada' no son un no", !saysNo("Nopal") && !saysNo("Sincronizada"));
  const bebidas = [
    { id: 45, name: "Coca-Cola 600ml" },
    { id: 46, name: "Coca-Cola Zero 600ml" },
    { id: 22, name: "Dr Pepper" },
  ];
  check("'Refresco Coca Cola ORIGINAL 600ml' es la Coca-Cola 600ml", similarProduct("Refresco Coca Cola ORIGINAL 600ml", bebidas)?.id === 45);
  check("'Coca Cola' se parece a dos: no se adivina", similarProduct("Coca Cola", bebidas) === undefined);
  check("'No, Gracias' nunca es un producto", similarProduct("No, Gracias", [{ id: 1, name: "No, Gracias" }]) === undefined);

  // ------------------------------------------------ combos
  const refrescos = { key: "ref", name: "Refresco Importado", min: 1, max: 1, included: 1, extraPrice: 0, options: [{ key: "dp", name: "Dr Pepper", productId: 22 }, { key: "mtn", name: "MTN DEW", productId: 23 }] };
  const especial = {
    id: 91,
    name: "Combo Especial",
    category: "Combos",
    price: 189,
    emoji: "🍔",
    modifierGroups: [{ key: "he", name: "Hamburguesa Especial", min: 1, max: 1, included: 1, extraPrice: 0, options: [{ key: "ny", name: "Hamburguesa NewYork BBQ", productId: 53 }, { key: "nyd", name: "Hamburguesa NewYork Doble BBQ", productId: 55 }] }, refrescos],
  };
  const aderezos = { key: "ad", name: "aderezo a elegir?", min: 1, max: 3, included: 1, extraPrice: 0, options: [{ key: "bbq", name: "Salsa BBQ", productId: 70 }, { key: "ajo", name: "Ajo Parmesano", productId: 71 }, { key: "qa", name: "Queso Amarillo", productId: 72 }] };
  const bonelessBurger = { id: 80, name: "Boneless Burger", category: "Burgers", price: 140, emoji: "🍔", modifierGroups: [aderezos, { key: "ex", name: "Deseas agregaar algun extra?", min: 1, max: 0, included: 0, extraPrice: 0, options: [{ key: "no", name: "No, Gracias" }, { key: "ce", name: "Carne Extra", productId: 75 }] }] };
  const catalog = [
    especial,
    bonelessBurger,
    { id: 53, name: "Hamburguesa NewYork BBQ", category: "Burgers", price: 99, emoji: "🍔" },
    { id: 55, name: "Hamburguesa NewYork Doble BBQ", category: "Burgers", price: 129, emoji: "🍔" },
    { id: 22, name: "Dr Pepper", category: "Bebidas", price: 39, emoji: "🥤" },
    { id: 23, name: "MTN DEW", category: "Bebidas", price: 39, emoji: "🥤" },
    { id: 45, name: "Coca-Cola 600ml", category: "Bebidas", price: 30, emoji: "🥤" },
    { id: 70, name: "Salsa BBQ", category: "Extras", price: 15, emoji: "🥣" },
    { id: 71, name: "Ajo Parmesano", category: "Extras", price: 15, emoji: "🥣" },
    { id: 72, name: "Queso Amarillo", category: "Extras", price: 15, emoji: "🥣" },
    { id: 75, name: "Carne Extra", category: "Extras", price: 35, emoji: "🥩" },
    { id: 60, name: "Papas Fritas", category: "Papas", price: 60, emoji: "🍟" },
  ] as never[];
  const ticket = (name: string, choices: { name: string; question: string; price?: number }[]) =>
    ({ kind: "delivery", platform: "DiDi Food", orderId: "1", customer: null, receivedAt: "", charges: [], total: 100, items: [{ index: 0, qty: 1, name, price: 189, notes: [], choices: choices.map((c) => ({ qty: 1, price: 0, ...c })), pending: false, stations: ["Parrilla"] }] }) as never;
  const line = (externalName: string) => ({ externalName });

  // DiDi #12 (venta 895): la Coca no es opción del combo de B-POS
  const didi12 = sale.deliverySelection(especial as never, catalog, ticket("Combo el mas Especial r", [
    { name: "newyork (tocino, bbq y aros)", question: "Elige tu hamburguesa mas especial" },
    { name: "Si", question: "Tus papas con catsup aparte?" },
    { name: "Refresco Coca Cola ORIGINAL 600ml", question: "Elige tu REF(SUJETO A DISPONIBLE)", price: 25 },
  ]), line("Combo el mas Especial r"));
  check("DiDi #12: no avisa", !("missingChoices" in didi12), didi12);
  check("DiDi #12: la Coca va en el combo y descuenta", (didi12.parts || []).some((p) => p.productId === 45 && p.label === "Refresco Importado"), didi12.parts);
  check("DiDi #12: y la NewYork BBQ también", (didi12.parts || []).some((p) => p.productId === 53), didi12.parts);
  check("DiDi #12: 'Si' (catsup aparte) no agrega nada", (didi12.parts || []).length === 2, didi12.parts);

  const conCocaAparte = sale.deliverySelection(especial as never, catalog, ticket("Combo el mas Especial r", [
    { name: "newyork (tocino, bbq y aros)", question: "Elige tu hamburguesa mas especial" },
    { name: "Refresco Coca Cola ORIGINAL 600ml", question: "Elige tu REF", price: 25 },
  ]), line("Combo el mas Especial r"), [{ externalName: "Refresco Coca Cola ORIGINAL 600ml", category: "Bebidas" }]);
  check("Coca que ya se vendió aparte: no se descuenta dos veces", !(conCocaAparte.parts || []).some((p) => p.productId === 45) && !("missingChoices" in conCocaAparte), conCocaAparte);

  const queTal = sale.deliverySelection(especial as never, catalog, ticket("Combo el mas Especial r", [
    { name: "newyork (tocino, bbq y aros)", question: "Elige tu hamburguesa mas especial" },
    { name: "No, Gracias", question: "¿Qué tal un refresco?" },
  ]), line("Combo el mas Especial r"));
  check("'¿Qué tal un refresco? → No, gracias': no avisa", !("missingChoices" in queTal), queTal);
  check("y no descuenta ningún refresco", !(queTal.parts || []).some((p) => p.label === "Refresco Importado"), queTal.parts);

  const soloNo = sale.deliverySelection(especial as never, catalog, ticket("Combo el mas Especial r", [{ name: "No, Gracias", question: "Que tal una bebida?" }]), line("Combo el mas Especial r"));
  check("'bebida → No' rechaza solo el refresco: la hamburguesa sigue faltando", JSON.stringify(soloNo.missingChoices) === JSON.stringify(["Hamburguesa Especial"]), soloNo);

  const nada = sale.deliverySelection(especial as never, catalog, ticket("Combo el mas Especial r", [{ name: "newyork (tocino, bbq y aros)", question: "Elige tu hamburguesa mas especial" }]), line("Combo el mas Especial r"));
  check("si el ticket no dice nada del refresco: sí avisa", (nada.missingChoices || []).includes("Refresco Importado"), nada);

  const papas = sale.deliverySelection(especial as never, catalog, ticket("Combo el mas Especial r", [
    { name: "newyork (tocino, bbq y aros)", question: "Elige tu hamburguesa mas especial" },
    { name: "Papas Fritas", question: "Elige tu refresco" },
  ]), line("Combo el mas Especial r"));
  check("producto de otra categoría en la pregunta del refresco… es esa pregunta: va", (papas.parts || []).some((p) => p.productId === 60), papas);
  const papasSinPregunta = sale.deliverySelection(especial as never, catalog, ticket("Combo el mas Especial r", [
    { name: "newyork (tocino, bbq y aros)", question: "Elige tu hamburguesa mas especial" },
    { name: "Papas Fritas", question: "" },
  ]), line("Combo el mas Especial r"));
  check("producto de otra categoría sin pregunta: no se mete al refresco, avisa", (papasSinPregunta.missingChoices || []).includes("Refresco Importado") && !(papasSinPregunta.parts || []).some((p) => p.productId === 60), papasSinPregunta);

  // Uber 4PZAS (venta 845): "Queso Parmesano" se parece a dos aderezos y el "No, Gracias" es de los refrescos
  const uber = sale.deliverySelection(bonelessBurger as never, catalog, ticket("Boneless Burger", [
    { name: "Queso Parmesano", question: "ELIGE TU ADEREZO" },
    { name: "No, Gracias", question: "APLICAN 2 REFRESCOS" },
  ]), line("Boneless Burger"));
  check("Uber 4PZAS: el aderezo que no se entiende sí avisa (no lo tapa el No de los refrescos)", (uber.missingChoices || []).includes("aderezo a elegir?"), uber);

  // ------------------------------------------------ sub-líneas de un producto sin opciones
  const simple = [
    { id: 1, name: "Aros de Cebolla" },
    { id: 2, name: "Ranch" },
    { id: 3, name: "Cebollitas Caramelizadas" },
    { id: 4, name: "Coca-Cola 600ml" },
  ];
  const raw = ["1x Aros de cebolla MX$90.00", "Elige tu aderezo", "1x Ranch MX$0.00", "Quieres extra?", "1x cebollitas caramelizadas MX$0.00", "Que tal un refresco?", "1x No, Gracias MX$0.00", "1x Si MX$0.00", "Total MX$90.00"].join("\n");
  const r = interpretOrder({ platform: "didi", rawText: raw, aliases: [], products: simple, ingredients: [] });
  const byName = (n: string) => r.products.find((p) => p.productName === n);
  check("sin pendientes ni errores", r.pending.length === 0 && r.errors.length === 0, { pending: r.pending, errors: r.errors });
  check("el Ranch gratis se vende (descuenta) en $0", byName("Ranch")?.free === true, r.products);
  check("las cebollitas gratis también", byName("Cebollitas Caramelizadas")?.free === true, r.products);
  check("los Aros se cobran normal", Boolean(byName("Aros de Cebolla")) && !byName("Aros de Cebolla")?.free, r.products);
  check("'No, Gracias' se ignora", r.ignored.some((i) => i.externalName === "No, Gracias") && !r.products.some((p) => /gracias/i.test(p.externalName)), r);
  check("'Si' se ignora", r.ignored.some((i) => i.externalName === "Si"), r.ignored);

  const cobrada = interpretOrder({ platform: "didi", rawText: ["1x Aros de cebolla MX$90.00", "Elige tu refresco", "1x Refresco Coca Cola ORIGINAL 600ml MX$25.00", "Total MX$115.00"].join("\n"), aliases: [], products: simple, ingredients: [] });
  check("refresco con costo debajo de un producto: se vende la Coca (no queda pendiente)", cobrada.products.some((p) => p.productName === "Coca-Cola 600ml" && !p.free) && cobrada.pending.length === 0, cobrada);

  const raro = interpretOrder({ platform: "didi", rawText: ["1x Aros de cebolla MX$90.00", "Elige tu extra", "1x Cosa rarísima MX$20.00", "Total MX$110.00"].join("\n"), aliases: [], products: simple, ingredients: [] });
  check("algo con costo que no se parece a nada: sigue pidiendo equivalencia", raro.pending.some((p) => p.externalName === "Cosa rarísima"), raro.pending);

  // ------------------------------------------------ la venta: el gratis va en $0
  const payload = prepareSalePayload({ platform: "didi", orderId: "77", total: 90, rawText: raw, interpretation: r, validation: { readyForSale: true } as never });
  check("el pedido preparado conserva que el Ranch es gratis", payload?.products.find((p) => p.name === "Ranch")?.free === true, payload?.products);
  localStorage.setItem("bpos_products", JSON.stringify(simple.map((p) => ({ ...p, category: "Extras", price: p.id === 1 ? 90 : 20, emoji: "🥣" }))));
  localStorage.setItem("bpos_orders", JSON.stringify([{ id: 900, items: [], total: 0, subtotal: 0, details: { discount: 0 }, createdAt: new Date().toISOString() }]));
  const fixed = sale.correctAutomaticSale(900, payload!, { by: "prueba" });
  const total = fixed.success ? fixed.sale.total : -1;
  check("la venta suma solo los Aros ($90): el Ranch y las cebollitas van en $0", total === 90, fixed);
  check("pero sí van en la venta (descuentan su inventario)", fixed.success && fixed.sale.items.some((i) => i.name === "Ranch" && i.price === 0), fixed);



  console.log(`\n${ok} bien, ${bad} mal`);
  if (bad) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
