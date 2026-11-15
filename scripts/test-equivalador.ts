/**
 * Equivalador de insumos (reparar recetas de lo que se sirve a ojo).
 *   npx tsx scripts/test-equivalador.ts
 */
import type { RecipeItem } from "@/data/inventory";
import type { Product } from "@/data/products";
import {
  applyOptionChanges,
  applyRecipeChanges,
  equivalenceWarnings,
  expectedUse,
  periodMoves,
  proposeEquivalence,
  roundQty,
  salesInRange,
  stockAt,
  type EquivalenceOrder,
} from "@/lib/recipe-equivalence";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}`);
};
const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) < e;

const LECHUGA = 10;
const mv = (createdAt: string, type: string, quantity: number, previousStock: number, finalStock: number, extra: Record<string, unknown> = {}) =>
  ({ ingredientId: LECHUGA, type, quantity, previousStock, finalStock, createdAt, ...extra }) as never;

// Martes 10 a domingo 15 (hora local)
const from = new Date(2026, 10, 10);
const to = new Date(2026, 10, 16);
const kardex = [
  mv(new Date(2026, 10, 9, 20).toISOString(), "Venta POS", 1, 11, 10),
  mv(new Date(2026, 10, 11, 9).toISOString(), "Ajuste positivo", 5, 9, 14, { reason: "C-000123 · Verduras Don Pepe" }),
  mv(new Date(2026, 10, 12, 13).toISOString(), "Merma", 1, 14, 13, { reason: "Caducó" }),
  mv(new Date(2026, 10, 13, 13).toISOString(), "Ajuste positivo", 0.5, 13, 13.5, { revertOf: "x" }),
  mv(new Date(2026, 10, 14, 13).toISOString(), "Ajuste negativo", 2, 13.5, 11.5, { reason: "Conteo" }),
  mv(new Date(2026, 10, 15, 22).toISOString(), "Venta POS", 7.5, 11.5, 4),
  mv(new Date(2026, 10, 17, 10).toISOString(), "Venta POS", 1, 4, 3),
  { ingredientId: 99, type: "Venta POS", quantity: 1, previousStock: 50, finalStock: 49, createdAt: new Date(2026, 10, 12).toISOString() } as never,
];

check("inició con: lo que dejó el último movimiento antes del martes", stockAt(kardex, LECHUGA, from, 3) === 10);
check("terminó con según el sistema: lo que había al cerrar el domingo", stockAt(kardex, LECHUGA, to, 3) === 4);
check("sin movimientos antes: usa la existencia con la que empezó el primero", stockAt(kardex, LECHUGA, new Date(2026, 0, 1), 3) === 11);
check("sin movimientos después: usa la existencia de ahora", stockAt(kardex, LECHUGA, new Date(2027, 0, 1), 3) === 3);

const pm = periodMoves(kardex, LECHUGA, from, to);
check("compras del rango", pm.purchases === 5);
check("mermas del rango", pm.waste === 1);
check("devolución de venta no cuenta como ajuste a mano", pm.manualIn === 0);
check("ajuste a mano negativo se avisa", pm.manualOut === 2);

const recipes: RecipeItem[] = [
  { productId: 1, ingredientId: LECHUGA, quantity: 0.025 }, // hamburguesa
  { productId: 2, ingredientId: LECHUGA, quantity: 0.12 }, // ensalada
  { productId: 1, ingredientId: 3, quantity: 1 }, // pan (no se toca)
  { productId: 5, ingredientId: LECHUGA, quantity: 0.03 }, // torta (no se vendió)
];
const products = [
  { id: 1, name: "Hamburguesa", modifierGroups: [{ key: "g1", name: "Extras", min: 0, included: 0, extraPrice: 0, options: [{ key: "o1", name: "Extra lechuga", ingredientId: LECHUGA, quantity: 0.01 }, { key: "o2", name: "Sin cebolla" }] }] },
  { id: 2, name: "Ensalada" },
  { id: 3, name: "Combo" },
  { id: 5, name: "Torta" },
] as unknown as Product[];

const at = (d: number, h = 14) => new Date(2026, 10, d, h).toISOString();
const orders = [
  { id: 1, createdAt: at(10), items: [{ id: 1, quantity: 200 }] },
  { id: 2, createdAt: at(11), items: [{ id: 2, quantity: 20 }] },
  // combo con 2 hamburguesas, 50 combos = 100 hamburguesas; con extra lechuga
  { id: 3, createdAt: at(12), items: [{ id: 3, quantity: 50, parts: [{ productId: 1, name: "Hamburguesa", quantity: 2, station: "Parrilla", modifiers: [{ group: "Extras", name: "Extra lechuga", price: 0, ingredientId: LECHUGA, quantity: 0.01 }] }] }] },
  { id: 4, createdAt: at(13), cancelled: true, items: [{ id: 1, quantity: 999 }] },
  { id: 5, createdAt: at(14), pendingPayment: true, items: [{ id: 1, quantity: 999 }] },
  { id: 6, createdAt: at(17), items: [{ id: 1, quantity: 999 }] },
  { id: 7, createdAt: at(15), items: [], bridgeActions: { inventoryAdjustments: [{ ingredientId: LECHUGA, quantity: 0.4 }] } },
] as EquivalenceOrder[];
const sales = salesInRange(orders, from, to);
check("ventas válidas: sin canceladas, sin cuentas abiertas, dentro del rango", sales.length === 4);

const exp = expectedUse(sales, LECHUGA, recipes);
check("hamburguesas vendidas (sueltas y dentro de combos)", exp.units.get(1) === 300);
check("ensaladas vendidas", exp.units.get(2) === 20);
check("lo de la receta: 300 × 0.025 + 20 × 0.12 = 9.9", near(exp.fromRecipes, 9.9));
check("extra lechuga elegida 100 veces = 1", near(exp.fromOptions, 1));
check("ajuste fijo de plataforma", near(exp.fixed, 0.4));
check("total según la receta", near(exp.total, 11.3));

// Inició 10 + compras 5 − merma 1 − realmente quedó 0.7 = 13.3 gastadas
const realUse = 10 + pm.purchases - pm.waste - 0.7;
const prop = proposeEquivalence({ ingredient: { id: LECHUGA, unit: "pza" }, realUse, expected: exp, recipes, products });
check("modo proporcional", prop.mode === "proporcional");
check("factor = (13.3 − 0.4) / 10.9", near(prop.factor, 12.9 / 10.9));
const burger = prop.recipeChanges.find((c) => c.productId === 1)!;
const salad = prop.recipeChanges.find((c) => c.productId === 2)!;
check("hamburguesa sube en la misma proporción", near(burger.to, roundQty(0.025 * (12.9 / 10.9), "pza")));
check("la ensalada sigue llevando más que la hamburguesa", salad.to > burger.to);
check("la torta (no vendida) también se corrige", prop.recipeChanges.some((c) => c.productId === 5));
check("la opción extra lechuga también se corrige", prop.optionChanges.length === 1 && near(prop.optionChanges[0].to, roundQty(0.01 * (12.9 / 10.9), "pza")));
// Con las recetas nuevas, lo vendido debe dar lo que de verdad se gastó
const newRecipes = applyRecipeChanges(recipes, LECHUGA, prop.recipeChanges);
const newExp = expectedUse(sales.map((o) => ({ ...o, items: (o.items || []).map((it) => ({ ...it, parts: it.parts?.map((p) => ({ ...p, modifiers: p.modifiers?.map((m) => ({ ...m, quantity: prop.optionChanges[0].to })) })) })) })), LECHUGA, newRecipes);
check("con las recetas nuevas cuadra con lo gastado real", near(newExp.total, realUse, 0.01));
check("el pan no se tocó", newRecipes.find((r) => r.ingredientId === 3)!.quantity === 1);
const newProducts = applyOptionChanges(products, prop.optionChanges);
const opt = newProducts[0].modifierGroups![0].options;
check("opción extra lechuga con la cantidad nueva", near(Number(opt[0].quantity), prop.optionChanges[0].to));
check("las demás opciones quedan igual", opt[1].quantity === undefined && newProducts[1] === products[1]);

// Sin cantidades todavía: reparte parejo (8 lechugas / 300 = 0.0267)
const zero: RecipeItem[] = [{ productId: 1, ingredientId: LECHUGA, quantity: 0 }];
const zExp = expectedUse([{ createdAt: at(10), items: [{ id: 1, quantity: 300 }] }], LECHUGA, zero);
const zProp = proposeEquivalence({ ingredient: { id: LECHUGA, unit: "pza" }, realUse: 8, expected: zExp, recipes: zero, products: [{ id: 1, name: "Hamburguesa" } as Product] });
check("sin cantidad en la receta: reparte parejo", zProp.mode === "parejo" && near(zProp.recipeChanges[0].to, 0.0267));

check("insumo que ninguna receta lleva: no propone nada", proposeEquivalence({ ingredient: { id: 77, unit: "g" }, realUse: 5, expected: expectedUse(sales, 77, recipes), recipes, products }).mode === "ninguno");
check("quedó más de lo que había: avisa revisar", proposeEquivalence({ ingredient: { id: LECHUGA, unit: "pza" }, realUse: -2, expected: exp, recipes, products }).mode === "ninguno");
check("gramos se redondean a 1 decimal", roundQty(12.345, "g") === 12.3);

const w = equivalenceWarnings({ realUse, expected: exp, proposal: prop, endIsSystem: true, manualIn: 0, manualOut: 2, unit: "pza" });
check("avisa que el final del sistema no muestra diferencia", w.some((x) => x.includes("según el sistema")));
check("avisa los ajustes a mano", w.some((x) => x.includes("ajustes a mano")));
const big = proposeEquivalence({ ingredient: { id: LECHUGA, unit: "pza" }, realUse: 40, expected: exp, recipes, products });
check("avisa cuando el cambio es muy grande", equivalenceWarnings({ realUse: 40, expected: exp, proposal: big, endIsSystem: false, manualIn: 0, manualOut: 0, unit: "pza" }).some((x) => x.includes("muy grande")));
const few = expectedUse([{ createdAt: at(10), items: [{ id: 1, quantity: 5 }] }], LECHUGA, recipes);
check("avisa cuando se vendió poco", equivalenceWarnings({ realUse: 1, expected: few, proposal: proposeEquivalence({ ingredient: { id: LECHUGA, unit: "pza" }, realUse: 1, expected: few, recipes, products }), endIsSystem: false, manualIn: 0, manualOut: 0, unit: "pza" }).some((x) => x.includes("Solo se vendieron")));

console.log(`\n${ok} bien, ${bad} mal`);
process.exit(bad ? 1 : 0);
