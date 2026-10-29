/** Horario de venta por producto. npx tsx scripts/test-horario.ts */
import { cleanSchedule, isOnSale, scheduleLabel } from "../lib/sale-schedule";

let ok = 0, bad = 0;
function check(name: string, cond: boolean) {
  if (cond) ok++; else { bad++; console.log("✗", name); }
}
// 2026-10-30 es viernes
const at = (day: string, time: string) => new Date(`2026-${day}T${time}:00`);
const FRI = "10-30", SAT = "10-31", THU = "10-29";

check("sin horario: siempre", isOnSale(undefined, at(THU, "03:00")));
check("todos los días sin horas = sin horario", cleanSchedule({ days: [0, 1, 2, 3, 4, 5, 6], from: "", to: "" }) === undefined);
const viernes = { days: [5], from: "", to: "" };
check("solo viernes: viernes sí", isOnSale(viernes, at(FRI, "10:00")));
check("solo viernes: jueves no", !isOnSale(viernes, at(THU, "10:00")));
const horas = { days: [5], from: "12:00", to: "22:00" };
check("viernes 12-22: 13:00 sí", isOnSale(horas, at(FRI, "13:00")));
check("viernes 12-22: 11:59 no", !isOnSale(horas, at(FRI, "11:59")));
check("viernes 12-22: 22:00 no", !isOnSale(horas, at(FRI, "22:00")));
check("viernes 12-22: sábado 13:00 no", !isOnSale(horas, at(SAT, "13:00")));
const noche = { days: [5], from: "20:00", to: "02:00" };
check("viernes 20-02: viernes 23:00 sí", isOnSale(noche, at(FRI, "23:00")));
check("viernes 20-02: sábado 01:30 sí", isOnSale(noche, at(SAT, "01:30")));
check("viernes 20-02: sábado 02:30 no", !isOnSale(noche, at(SAT, "02:30")));
check("viernes 20-02: viernes 01:00 no (es del jueves)", !isOnSale(noche, at(FRI, "01:00")));
const diario = { days: [], from: "08:00", to: "12:00" };
check("diario 8-12: jueves 9:00 sí", isOnSale(diario, at(THU, "09:00")));
check("diario 8-12: jueves 12:30 no", !isOnSale(diario, at(THU, "12:30")));
check("etiqueta", scheduleLabel(horas) === "Solo Vie · 12:00 a 22:00");
check("etiqueta diaria", scheduleLabel(diario) === "Todos los días · 08:00 a 12:00");

console.log(`${ok} bien, ${bad} mal`);
if (bad) process.exit(1);
