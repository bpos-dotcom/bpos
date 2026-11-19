/**
 * Sincronización ligera: el kardex y las ventas descontadas viajan renglón
 * por renglón, y la revisión hacia atrás no vuelve a bajar lo ya visto.
 *   npx tsx scripts/test-sync-ligera.ts
 */
import {
  applyRowChanges,
  cloudCollection,
  countedIds,
  localKeyOf,
  rememberSeqs,
  ROW_KEYS,
  rowListOf,
  unseenSeqs,
} from "@/lib/cloud/row-keys";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

const K = "bpos_inventory_kardex";
const A = "bpos_inventory_applied_sales";

// Colecciones: los equipos viejos no leen la nueva; los nuevos no aplican el documento viejo
check("kardex va a rows:", cloudCollection(K) === `rows:${K}`);
check("ventas descontadas van a rows:", cloudCollection(A) === `rows:${A}`);
check("pedidos siguen igual", cloudCollection("bpos_orders") === "bpos_orders");
check("rows: → llave del navegador", localKeyOf(`rows:${K}`) === K);
check("el documento viejo del kardex no se aplica", localKeyOf(K) === null);
check("una colección rows: desconocida no se aplica", localKeyOf("rows:bpos_otra") === null);
check("pedidos → pedidos", localKeyOf("bpos_orders") === "bpos_orders");

// Ids calculados: estables y únicos
const at = (d: number, h = 12) => new Date(2026, 10, d, h).toISOString();
const kardex = [
  { id: "s1", ingredientId: 1, createdAt: at(17, 10), quantity: 1 },
  { id: "s1", ingredientId: 2, createdAt: at(17, 10), quantity: 2 },
  { id: "s1", ingredientId: 2, createdAt: at(17, 10), quantity: 3 },
  { id: "s2", ingredientId: 1, createdAt: at(17, 11), quantity: 1 },
];
const ids = ROW_KEYS[K](kardex);
check("kardex: ids únicos aunque se repitan", new Set(ids).size === ids.length, ids);
check("kardex: mismos ids cada vez", JSON.stringify(ROW_KEYS[K](kardex)) === JSON.stringify(ids));
const appliedIds = ROW_KEYS[A](["didi:1", "uber:9", "didi:1"]);
check("ventas descontadas: repetidas con contador", JSON.stringify(appliedIds) === JSON.stringify(["didi:1", "uber:9", "didi:1~2"]), appliedIds);
check("countedIds", JSON.stringify(countedIds(["a", "a", "b"])) === JSON.stringify(["a", "a~2", "b"]));

// Otro equipo recibe una venta nueva: solo sus renglones, al final y en orden
const sale3 = [
  { id: "s3", ingredientId: 1, createdAt: at(17, 13), quantity: 1 },
  { id: "s3", ingredientId: 4, createdAt: at(17, 13), quantity: 1 },
];
const remoteIds = ROW_KEYS[K]([...kardex, ...sale3]).slice(4);
const shadow: Record<string, string> = {};
const next = applyRowChanges(K, kardex, sale3.map((data, i) => ({ record_id: remoteIds[i], data, deleted: false, hash: `h${i}` })), shadow);
check("se agregan los 2 renglones nuevos", next.length === 6, next.length);
check("van al final, en orden", (next[4] as { id: string }).id === "s3" && (next[5] as { ingredientId: number }).ingredientId === 4);
check("la sombra recuerda los nuevos", shadow[remoteIds[0]] === "h0" && shadow[remoteIds[1]] === "h1");

// El eco (lo que ya tengo) no duplica
const again = applyRowChanges(K, next, sale3.map((data, i) => ({ record_id: remoteIds[i], data, deleted: false, hash: `h${i}` })), shadow);
check("eco: no se duplica", again.length === 6, again.length);

// Un renglón que llega tarde (más viejo) entra en su lugar
const late = { id: "s0", ingredientId: 9, createdAt: at(17, 9), quantity: 1 };
const withLate = applyRowChanges(K, next, [{ record_id: "s0~9~x", data: late, deleted: false, hash: "z" }], {});
check("renglón viejo entra antes, en orden", (withLate[0] as { id: string }).id === "s0" && withLate.length === 7);

// Borrado (el kardex viejo que se fue a la nube)
const deleted = applyRowChanges(K, next, [{ record_id: ids[0], data: null, deleted: true }], { [ids[0]]: "x" });
check("borrar quita solo ese renglón", deleted.length === 5 && !(deleted as { quantity: number }[]).some((m, i) => i === 0 && m.quantity === 1 && (m as unknown as { ingredientId: number }).ingredientId === 1 && (m as unknown as { id: string }).id === "s1"));

// Un equipo que tenía el kardex igual (documento viejo) recibe los mismos renglones: no duplica
const same = applyRowChanges(K, kardex, kardex.map((data, i) => ({ record_id: ids[i], data, deleted: false, hash: `q${i}` })), {});
check("misma lista desde la nube: no duplica", same.length === kardex.length, same.length);

// Lista guardada
check("rowListOf: vacío", rowListOf(null).length === 0 && rowListOf("no json").length === 0 && rowListOf("{}").length === 0);
check("rowListOf: lista", rowListOf(JSON.stringify(kardex)).length === 4);

// Revisión hacia atrás: solo lo no visto
const seen = new Set<number>([10, 11, 12]);
check("unseen: solo lo nuevo", JSON.stringify(unseenSeqs([10, 11, 12, 13, 15], seen)) === JSON.stringify([13, 15]));
check("unseen: nada nuevo → nada que bajar", unseenSeqs([10, 11, 12], seen).length === 0);
const big = new Set<number>();
rememberSeqs(big, Array.from({ length: 5000 }, (_, i) => i), 3000);
check("recuerda máximo 3000 (los más nuevos)", big.size === 3000 && big.has(4999) && !big.has(0), big.size);

// Tamaño: una venta mueve unos cuantos renglones, no el kardex entero
const fullKardex = Array.from({ length: 3300 }, (_, i) => ({ id: `s${Math.floor(i / 5)}`, type: "venta", unit: "pz", reason: "Venta", quantity: 1, createdAt: at(10 + (i % 7)), finalStock: 10, ingredientId: i % 50, previousStock: 11, ingredientName: "Insumo de prueba" }));
const perSale = JSON.stringify(fullKardex.slice(0, 5)).length;
const wholeDoc = JSON.stringify(fullKardex).length;
check(`una venta: ~${Math.round(perSale / 1024)} KB en vez de ~${Math.round(wholeDoc / 1024)} KB`, perSale * 100 < wholeDoc);

console.log(`\n${ok} bien, ${bad} mal`);
if (bad) process.exit(1);
