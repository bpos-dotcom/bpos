/**
 * La caja guarda solo este mes y el pasado; lo demás se consulta en la nube.
 *   npx tsx scripts/test-ventas-en-caja.ts
 */
import { archivedPart, isArchivedOrder, localOrdersCutoff, mergeOrders, pruneArchivedOrders } from "@/lib/order-archive";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}`);
};

const now = new Date(2026, 10, 14, 23, 0); // 14 nov
const cutoff = localOrdersCutoff(now);
check("corte = 1 de octubre", cutoff.getFullYear() === 2026 && cutoff.getMonth() === 9 && cutoff.getDate() === 1);
check("en enero el corte es 1 de diciembre del año pasado", localOrdersCutoff(new Date(2027, 0, 5)).getMonth() === 11 && localOrdersCutoff(new Date(2027, 0, 5)).getFullYear() === 2026);

const iso = (y: number, m: number, d: number) => new Date(y, m, d, 14).toISOString();
const oldPaid = { id: 1, createdAt: iso(2026, 8, 20), total: 100 };
const oldOpen = { id: 2, createdAt: iso(2026, 8, 25), total: 50, pendingPayment: true };
const lastMonth = { id: 3, createdAt: iso(2026, 9, 2), total: 80 };
const thisMonth = { id: 4, createdAt: iso(2026, 10, 10), total: 90 };
const oldNotSynced = { id: 5, createdAt: iso(2026, 7, 1), total: 70 };

check("venta cobrada de septiembre: va a la nube", isArchivedOrder(oldPaid, cutoff));
check("cuenta abierta vieja: se queda en la caja", !isArchivedOrder(oldOpen, cutoff));
check("venta del mes pasado: se queda", !isArchivedOrder(lastMonth, cutoff));
check("venta de este mes: se queda", !isArchivedOrder(thisMonth, cutoff));
check("sin fecha: se queda", !isArchivedOrder({ id: 9 }, cutoff));

const list = [oldNotSynced, oldPaid, oldOpen, lastMonth, thisMonth];
const { kept, removedIds } = pruneArchivedOrders(list, cutoff, (o) => o.id !== 5);
check("solo se quita lo viejo que ya está en la nube", removedIds.join() === "1");
check("lo que no se ha subido se queda aunque sea viejo", kept.some((o) => o.id === 5));
check("se quedan abiertas, mes pasado y este mes", [2, 3, 4].every((id) => kept.some((o) => o.id === id)));

const merged = mergeOrders([lastMonth, thisMonth], [oldPaid, { ...lastMonth, total: 1 }]);
check("unir: agrega las de la nube", merged.length === 3 && merged[0].id === 1);
check("unir: la de la caja gana si está repetida", merged.find((o) => o.id === 3)!.total === 80);
check("unir: ordenadas de vieja a nueva", merged.map((o) => o.id).join() === "1,3,4");
check("unir sin nube: la misma lista", mergeOrders(kept, []) === kept);

check("rango de este mes: no consulta la nube", archivedPart(new Date(2026, 10, 1), new Date(2026, 11, 1), cutoff) === null);
const p = archivedPart(new Date(2026, 7, 1), new Date(2026, 11, 1), cutoff)!;
check("rango desde agosto: consulta agosto y septiembre en la nube", p.from.getMonth() === 7 && p.to.getTime() === cutoff.getTime());
const q = archivedPart(new Date(2026, 6, 1), new Date(2026, 7, 1), cutoff)!;
check("rango todo viejo: hasta donde termina", q.to.getMonth() === 7);

console.log(`\n${ok} bien, ${bad} mal`);
process.exit(bad ? 1 : 0);
