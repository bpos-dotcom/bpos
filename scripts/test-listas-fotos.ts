/**
 * Prueba de las listas de tareas con foto por tarea (Productividad):
 *   npx tsx scripts/test-listas-fotos.ts
 */
const store = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g.window = globalThis;
g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
g.dispatchEvent = () => true;
g.Event = class {};
g.CustomEvent = class {};

async function main() {
  const P = await import("@/lib/productivity");
  const t = P.saveTask({ kind: "lista", title: "Cierre", items: ["Trastes", "Plancha", "Luces"], photoItems: ["Trastes", "Plancha"], schedule: { mode: "una", date: "2026-11-11", time: "00:01" }, repeatMinutes: 0, evidence: false, voice: false, notifyDone: true, ownerAfterMinutes: 0, active: true });
  const get = () => P.pendingTasks().find((p) => p.task.id === t.id)!;
  let ok = 0, bad = 0;
  const check = (name: string, cond: boolean) => { console.log(cond ? "OK " : "MAL", name);
    if (cond) ok++;
    else bad++; };

  check("lista pendiente", Boolean(get()));
  let threw = false;
  try { P.toggleListItem(get(), "Trastes"); } catch { threw = true; }
  check("tarea con foto no se palomea sin foto", threw);
  P.toggleListItem(get(), "Luces");
  check("tarea sin foto se palomea", P.listProgress(get()).done === 1);
  threw = false;
  try { P.completeTask(get()); } catch { threw = true; }
  check("no se termina con faltantes", threw);
  P.toggleListItem(get(), "Trastes", "https://x/trastes.webp");
  check("foto de Trastes guardada", get().record?.photos?.Trastes === "https://x/trastes.webp");
  // Lo que hicieron en el celular: Plancha con foto
  P.mergeRemoteList(get(), [
    { name: "Trastes", photo: true, url: "https://x/trastes.webp", done: true, by: "Gerardo", at: "2026-11-11T10:00:00Z" },
    { name: "Plancha", photo: true, url: "https://x/plancha.webp", done: true, by: "Damaris", at: "2026-11-11T10:05:00Z" },
    { name: "Luces", photo: false, url: null, done: true, by: "Gerardo", at: "2026-11-11T10:06:00Z" },
  ]);
  const rec = P.getLog().find((r) => r.taskId === t.id)!;
  check("se terminó sola al completar en el celular", rec.status === "hecho");
  check("ya no está pendiente", !P.pendingTasks().some((p) => p.task.id === t.id));
  check("quedan las 2 fotos", Object.keys(rec.photos || {}).length === 2);
  check("quedan quienes la hicieron", rec.doneBy === "Gerardo, Damaris");
  console.log(`\n${ok} bien, ${bad} mal`);
  process.exit(0);
}
void main();

export {};
