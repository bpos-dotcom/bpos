/**
 * Medidor de la memoria del navegador (aviso al 70 %).
 *   npx tsx scripts/test-memoria-navegador.ts
 */
import { STORAGE_LIMIT, STORAGE_WARN, storageUsage, usageReport } from "@/lib/storage-usage";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

const fake = (data: Record<string, string>) => {
  const keys = Object.keys(data);
  return { length: keys.length, key: (i: number) => keys[i] ?? null, getItem: (k: string) => data[k] ?? null };
};

// Como la caja del 27 nov: 5.24 M en total
const full = storageUsage(fake({ bpos_orders: "x".repeat(3_310_000), bpos_inventory_kardex: "x".repeat(1_350_000), bpos_products: "x".repeat(80_000), otra: "x".repeat(500_000) }));
check("cuenta letras de llaves y valores", full.total === 3_310_000 + 1_350_000 + 80_000 + 500_000 + "bpos_orders".length + "bpos_inventory_kardex".length + "bpos_products".length + "otra".length, full.total);
check("la caja del 27 nov pasa del aviso", full.ratio > STORAGE_WARN, full.ratio);
check("lo más grande primero", full.top[0][0] === "bpos_orders" && full.top[1][0] === "bpos_inventory_kardex");
check("reporte legible para soporte", usageReport(full).startsWith("Total 5.24 M · orders 3.31 · inventory_kardex 1.35"), usageReport(full));

const half = storageUsage(fake({ bpos_orders: "x".repeat(STORAGE_LIMIT / 2) }));
check("a la mitad no avisa", half.ratio < STORAGE_WARN, half.ratio);
check("vacío no truena", storageUsage(fake({})).total === 0);

console.log(`\n${ok} bien, ${bad} mal`);
if (bad) process.exit(1);
