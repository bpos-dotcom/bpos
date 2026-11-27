/**
 * Inventario entre equipos: lo que mueve cada uno se suma, no se pisa.
 *   npx tsx scripts/test-inventario-suma.ts
 */
import { mergeInventoryItem } from "../lib/cloud/inventory-merge";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

const tapa = { id: 1793847391161, name: "Tapa 1oz", unit: "pza", stock: 120, minimum: 50 };

// 24 nov: el celular (atrasado, veía 120) sube la compra de 300; la caja ya iba en 70
const compra = mergeInventoryItem(tapa, { ...tapa, stock: 420 }, { ...tapa, stock: 70 });
check("compra en el celular atrasado: 70 en la nube + 300 = 370", compra.stock === 370, compra);

// 26 nov: el celular (veía 31) vende 1; la caja iba en 5: no regresa a 30
const venta = mergeInventoryItem({ ...tapa, stock: 31 }, { ...tapa, stock: 30 }, { ...tapa, stock: 5 });
check("venta en el celular atrasado: 5 − 1 = 4 (no regresa a 30)", venta.stock === 4, venta);

// La caja vende 2 mientras el celular compra 300 sobre la misma base
const caja = { ...tapa, stock: 118 };
const ambos = mergeInventoryItem(tapa, { ...tapa, stock: 420 }, caja);
check("venta en la caja y compra en el celular: 120 − 2 + 300 = 418", ambos.stock === 418, ambos);

// Decimales (kg)
const kg = { id: 2, name: "Boneless", unit: "kg", stock: 17.25 };
const kgm = mergeInventoryItem(kg, { ...kg, stock: 53.25 }, { ...kg, stock: 16.5 });
check("kilos: 16.5 + 36 = 52.5", kgm.stock === 52.5, kgm);

// Otros datos: gana lo que cambió este equipo; lo demás, la nube
const datos = mergeInventoryItem(tapa, { ...tapa, minimum: 100 }, { ...tapa, stock: 60, category: "Empaques" });
check("cambió el mínimo aquí y la categoría allá: quedan los dos", datos.minimum === 100 && datos.category === "Empaques" && datos.stock === 60, datos);

// Sin base (equipo recién actualizado con cambios sin subir): como antes
const sinBase = { ...tapa, stock: 999 };
check("sin base: se sube lo de este equipo (como antes)", mergeInventoryItem(undefined, sinBase, tapa) === sinBase);

console.log(`\n${ok} bien, ${bad} mal`);
if (bad) process.exit(1);
