/**
 * Kardex: en la caja solo los últimos días, lo viejo en la nube.
 *   npx tsx scripts/test-kardex-nube.ts
 */
import { archiveIds, archivedKardexPart, KARDEX_LOCAL_DAYS, localKardexCutoff, mergeKardex, splitKardex } from "@/lib/kardex-archive";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

const now = new Date(2026, 10, 18, 0, 30);
const cutoff = localKardexCutoff(now);
check(`el corte es hace ${KARDEX_LOCAL_DAYS} días a las 00:00`, cutoff.getTime() === new Date(2026, 10, 18 - KARDEX_LOCAL_DAYS).getTime(), cutoff);

const day = (d: number, h = 12) => new Date(2026, 10, d, h).toISOString();
// Una venta descuenta varios insumos con el MISMO id (así guarda el kardex)
const kardex = [
  { id: "sale-1", ingredientId: 1, createdAt: day(4), quantity: 1 },
  { id: "sale-1", ingredientId: 2, createdAt: day(4), quantity: 2 },
  { id: "sale-1", ingredientId: 2, createdAt: day(4), quantity: 3 }, // mismo insumo dos veces en la venta
  { id: "sale-9", ingredientId: 1, createdAt: day(17), quantity: 1 },
  { id: "raro", ingredientId: 1, createdAt: "sin fecha", quantity: 1 },
];
const { keep, old } = splitKardex(kardex, cutoff);
check("lo de hace dos semanas va a la nube", old.length === 3, old.length);
check("lo de ayer y lo sin fecha se quedan", keep.length === 2 && keep.some((m) => m.id === "raro"));

const ids = archiveIds(old);
check("ids únicos aunque se repita id, insumo y fecha", new Set(ids).size === ids.length, ids);
check("mismos ids si se vuelve a subir (no duplica)", JSON.stringify(archiveIds(old)) === JSON.stringify(ids));

// Une la caja con la nube: lo que ya tiene la caja no se repite y queda en orden
const merged = mergeKardex(keep, [...old, kardex[3]]);
check("unir: 5 movimientos, sin repetir el de ayer", merged.length === 5, merged.length);
check("unir: del más viejo al más nuevo", merged[0].createdAt === day(4) && merged.filter((m) => m.id === "sale-9").length === 1);
check("unir sin nada de la nube regresa lo mismo", mergeKardex(keep, []) === keep);

check("rango dentro de la caja no consulta la nube", archivedKardexPart(new Date(2026, 10, 18 - KARDEX_LOCAL_DAYS + 1), null, cutoff) === null);
const part = archivedKardexPart(new Date(2026, 10, 1), new Date(2026, 10, 18), cutoff);
check("rango viejo consulta la nube solo hasta el corte", !!part && part.to.getTime() === cutoff.getTime(), part);

// Tamaño: el 27 nov eran ~600 movimientos al día de ~330 letras; 7 días pesaban 1.35 M
check(`${KARDEX_LOCAL_DAYS} días de kardex (con el de hoy) pesan menos de 0.7 M`, 600 * (KARDEX_LOCAL_DAYS + 1) * 330 < 700_000);
check("guarda menos de 7 días (7 días llenaron la caja)", KARDEX_LOCAL_DAYS < 7);

console.log(`\n${ok} bien, ${bad} mal`);
if (bad) process.exit(1);
