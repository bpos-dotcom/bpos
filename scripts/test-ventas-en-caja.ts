/**
 * La caja guarda solo los últimos 10 días; lo demás se consulta en la nube
 * (27 nov: con dos meses de ventas se llenó la memoria del navegador y la
 * caja ya no guardaba pedidos).
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
check("corte = 4 de noviembre 00:00", cutoff.getFullYear() === 2026 && cutoff.getMonth() === 10 && cutoff.getDate() === 4 && cutoff.getHours() === 0);
const jan = localOrdersCutoff(new Date(2027, 0, 5));
check("el 5 de enero el corte es 26 de diciembre del año pasado", jan.getFullYear() === 2026 && jan.getMonth() === 11 && jan.getDate() === 26);

const iso = (y: number, m: number, d: number) => new Date(y, m, d, 14).toISOString();
const oldPaid = { id: 1, createdAt: iso(2026, 9, 20), total: 100 };
const oldOpen = { id: 2, createdAt: iso(2026, 9, 25), total: 50, pendingPayment: true };
const recent = { id: 3, createdAt: iso(2026, 10, 5), total: 80 };
const today = { id: 4, createdAt: iso(2026, 10, 14), total: 90 };
const oldNotSynced = { id: 5, createdAt: iso(2026, 9, 1), total: 70 };
const elevenDays = { id: 6, createdAt: iso(2026, 10, 3), total: 60 };

check("venta cobrada de octubre: va a la nube", isArchivedOrder(oldPaid, cutoff));
check("venta de hace 11 días: va a la nube", isArchivedOrder(elevenDays, cutoff));
check("cuenta abierta vieja: se queda en la caja", !isArchivedOrder(oldOpen, cutoff));
check("venta de hace 9 días: se queda", !isArchivedOrder(recent, cutoff));
check("venta de hoy: se queda", !isArchivedOrder(today, cutoff));
check("sin fecha: se queda", !isArchivedOrder({ id: 9 }, cutoff));

const list = [oldNotSynced, oldPaid, oldOpen, recent, today];
const { kept, removedIds } = pruneArchivedOrders(list, cutoff, (o) => o.id !== 5);
check("solo se quita lo viejo que ya está en la nube", removedIds.join() === "1");
check("lo que no se ha subido se queda aunque sea viejo", kept.some((o) => o.id === 5));
check("se quedan abiertas y las de los últimos días", [2, 3, 4].every((id) => kept.some((o) => o.id === id)));

const merged = mergeOrders([recent, today], [oldPaid, { ...recent, total: 1 }]);
check("unir: agrega las de la nube", merged.length === 3 && merged[0].id === 1);
check("unir: la de la caja gana si está repetida", merged.find((o) => o.id === 3)!.total === 80);
check("unir: ordenadas de vieja a nueva", merged.map((o) => o.id).join() === "1,3,4");
check("unir sin nube: la misma lista", mergeOrders(kept, []) === kept);

check("rango de los últimos días: no consulta la nube", archivedPart(new Date(2026, 10, 5), new Date(2026, 10, 15), cutoff) === null);
const m = archivedPart(new Date(2026, 10, 1), new Date(2026, 10, 15), cutoff)!;
check("este mes completo: del 1 al 4 se consulta en la nube", m.from.getDate() === 1 && m.to.getTime() === cutoff.getTime());
const q = archivedPart(new Date(2026, 6, 1), new Date(2026, 7, 1), cutoff)!;
check("rango todo viejo: hasta donde termina", q.to.getMonth() === 7);

console.log(`\n${ok} bien, ${bad} mal`);
process.exit(bad ? 1 : 0);
