/**
 * Historial de Productividad (app del dueño): días con lo atendido y sus fotos.
 *   npx tsx scripts/test-historial-productividad.ts
 */
import { dayKey, productivityHistory, type ShiftMessage, type TaskRecord } from "@/lib/productivity";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

const at = (day: number, h: number) => new Date(2026, 10, day, h, 0).toISOString();
const rec = (id: string, p: Partial<TaskRecord>): TaskRecord => ({ id, taskId: id, title: id, kind: "lista", slot: at(11, 12), status: "hecho", ...p });

const log: TaskRecord[] = [
  rec("apertura", { slot: at(11, 12), doneAt: at(11, 13), doneBy: "CAJERO", photos: { "Papas jumbo": "https://x/1.jpg" }, photo: "https://x/0.jpg" }),
  rec("cierre", { slot: at(11, 22), doneAt: at(11, 23), doneBy: "CAJERO" }),
  rec("plancha", { slot: at(12, 12), doneAt: at(12, 12), doneBy: "ANA" }),
  rec("a medias", { slot: at(10, 12), status: "en curso", checked: ["Prender freidoras"], photos: { "Prender freidoras": "https://x/2.jpg" } }),
  rec("nadie la tocó", { slot: at(10, 18), status: "en curso" }),
];
const messages = [{ id: "m1", text: "Llega el pan", createdAt: at(11, 9), acks: [] }] as unknown as ShiftMessage[];

const days = productivityHistory(log, messages);
check("un día por fecha, del más nuevo al más viejo", days.map((d) => d.day).join(",") === "2026-11-12,2026-11-11,2026-11-10", days.map((d) => d.day));
const ayer = days.find((d) => d.day === dayKey(new Date(2026, 10, 11)))!;
check("ayer: sus 2 atendidos", ayer.done.length === 2);
check("más reciente primero", ayer.done[0].id === "cierre");
check("las fotos de ayer siguen ahí", ayer.done.some((r) => r.photos?.["Papas jumbo"] && r.photo));
check("mensajes del turno en su día", ayer.messages.length === 1);
const antier = days.find((d) => d.day === "2026-11-10")!;
check("lista empezada y sin terminar sale con su foto", antier.unfinished.length === 1 && antier.unfinished[0].photos?.["Prender freidoras"] === "https://x/2.jpg");
check("lo que nunca se empezó no ensucia el historial", !antier.unfinished.some((r) => r.id === "nadie la tocó"));
check("sin nada: historial vacío", productivityHistory([], []).length === 0);

console.log(`\n${ok} bien, ${bad} mal`);
process.exit(bad ? 1 : 0);
