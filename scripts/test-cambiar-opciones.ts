/**
 * Cambiar las opciones de un renglón que ya está en el pedido: lo que tiene
 * el renglón se vuelve a abrir con lo mismo marcado (y al guardar sin cambios
 * queda idéntico), y se le puede agregar algo después (las papas de $20).
 *   npx tsx scripts/test-cambiar-opciones.ts
 */
import { OWN_OPTIONS, buildSelection, extrasPrice, lineIdFor, linkedOwner, picksFromLine } from "../lib/compound";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

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
    { key: "papas", name: "Papas", extraPrice: 20 },
  ],
};
const salsas = { key: "sa", name: "Salsas", min: 1, max: 3, included: 2, extraPrice: 10, options: [{ key: "bbq", name: "BBQ" }, { key: "buf", name: "Búfalo" }] };
const burger = { id: 47, name: "Hamburguesa Mexicana", category: "Burgers", price: 79, emoji: "🍔", station: "Parrilla", modifierGroups: [extras] };
const boneless = { id: 30, name: "Boneless", category: "Pollo", price: 99, emoji: "🍗", station: "Freidora", modifierGroups: [salsas] };
const combo = {
  id: 90,
  name: "Combo",
  category: "Combos",
  price: 180,
  emoji: "🍔",
  modifierGroups: [
    { key: "hb", name: "Elige tu hamburguesa", min: 1, max: 1, included: 1, extraPrice: 0, options: [{ key: "m", name: "Mexicana", productId: 47 }] },
    { key: "bo", name: "Boneless", min: 1, max: 1, included: 1, extraPrice: 0, options: [{ key: "b", name: "Boneless", productId: 30 }] },
  ],
};
const carne = { id: 61, name: "Carne Extra", category: "Extras", price: 25, emoji: "🥩", station: "Parrilla" };
const products = [burger, boneless, combo, carne] as never[];
const idOf = (product: never, picks: Record<string, Record<string, string[]>>) => {
  const s = buildSelection(product, products, picks);
  return { id: lineIdFor((product as { id: number }).id, s.parts, s.modifiers), price: (product as { price: number }).price + extrasPrice(s.modifiers, s.parts), s };
};
const roundTrip = (name: string, product: never, picks: Record<string, Record<string, string[]>>) => {
  const first = idOf(product, picks);
  const back = picksFromLine(product, products, first.s);
  const again = idOf(product, back);
  check(`${name}: se vuelve a abrir igual`, again.id === first.id, { antes: first.id, despues: again.id, back });
  return back;
};

// La Mexicana con "No, Gracias" (la de la foto)
const back = roundTrip("Mexicana sin extra", burger as never, { [OWN_OPTIONS]: { ex: ["no"] } });
check("marca 'No, Gracias'", back[OWN_OPTIONS].ex?.join() === "no", back);
// El cliente quiso agregar las papas de $20: cambia a papas
const conPapas = idOf(burger as never, { [OWN_OPTIONS]: { ex: ["papas"] } });
check("con papas: $99", conPapas.price === 99, conPapas.price);
check("con papas: otro renglón (otra clave)", conPapas.id !== idOf(burger as never, { [OWN_OPTIONS]: { ex: ["no"] } }).id);

roundTrip("con carne extra (producto enlazado con precio)", burger as never, { [OWN_OPTIONS]: { ex: ["carne"] } });
roundTrip("carne y papas", burger as never, { [OWN_OPTIONS]: { ex: ["carne", "papas"] } });
roundTrip("salsas repetidas y extra cobrada", boneless as never, { [OWN_OPTIONS]: { sa: ["bbq", "bbq", "buf"] } });

// Combo: la hamburguesa con su carne extra y los boneless con sus salsas
const comboBack = roundTrip("combo con opciones de sus productos", combo as never, {
  [linkedOwner(47)]: { ex: ["carne"] },
  [linkedOwner(30)]: { sa: ["buf", "buf"] },
});
check("combo: la carne extra de la hamburguesa", comboBack[linkedOwner(47)]?.ex?.join() === "carne", comboBack);
check("combo: las salsas de los boneless", comboBack[linkedOwner(30)]?.sa?.join() === "buf,buf", comboBack);

// Si el producto cambió y una opción ya no existe, se omite sin tronar
const viejo = idOf(burger as never, { [OWN_OPTIONS]: { ex: ["papas"] } }).s;
const sinPapas = { ...burger, modifierGroups: [{ ...extras, options: extras.options.filter((o) => o.key !== "papas") }] };
const b2 = picksFromLine(sinPapas as never, products, viejo);
check("opción que ya no existe: se omite", !b2[OWN_OPTIONS].ex, b2);

console.log(`\n${ok} bien, ${bad} mal`);
if (bad) process.exit(1);
