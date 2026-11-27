/**
 * Un equipo atrasado no regresa la caja de ayer (26 nov: un celular con la
 * caja del 25 aceptó un pedido y la caja siguió vendiendo en el turno ya cortado).
 *   npx tsx scripts/test-turno-no-se-pisa.ts
 */
import { resolveShiftPush } from "../lib/cloud/shift-guard";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

const ayer = { sessionId: "shift-25", openedAt: "2026-11-25T19:49:29.967Z", orderCounter: 17, openingCash: 300 };
const hoy = { sessionId: "shift-26", openedAt: "2026-11-26T19:55:28.347Z", orderCounter: 10, openingCash: 300 };

// El caso del 26 nov
const celular = resolveShiftPush(ayer, hoy, true);
check("celular con la caja de ayer: no sube, se queda con la de hoy", celular.action === "adopt" && celular.value === hoy, celular);

const cerrada = resolveShiftPush(ayer, null, true);
check("celular con la caja de ayer y la caja ya cerró: queda cerrada", cerrada.action === "adopt" && cerrada.value === null, cerrada);

const abierta = resolveShiftPush(null, hoy, true);
check("aquí se cerró pero otro equipo abrió: se queda la abierta", abierta.action === "adopt" && abierta.value === hoy, abierta);

// Lo normal en la caja principal
check("nadie más la cambió: se sube (abrir)", resolveShiftPush(hoy, null, false).action === "push");
check("nadie más la cambió: se sube (cerrar)", resolveShiftPush(null, hoy, false).action === "push");
check("nadie más la cambió: se sube (nuevo pedido)", resolveShiftPush({ ...hoy, orderCounter: 11 }, hoy, false).action === "push");

// Mismo turno cambiado en dos equipos: no se repiten folios
const mas = resolveShiftPush({ ...hoy, orderCounter: 12 }, { ...hoy, orderCounter: 11, movements: [1] }, true);
check("mismo turno: lo de la nube con el folio más alto", mas.action === "push" && mas.value?.orderCounter === 12 && Array.isArray(mas.value?.movements), mas);
const menos = resolveShiftPush({ ...hoy, orderCounter: 9 }, { ...hoy, orderCounter: 11 }, true);
check("mismo turno y la nube va más adelante: se queda la nube", menos.action === "adopt" && menos.value?.orderCounter === 11, menos);

console.log(`\n${ok} bien, ${bad} mal`);
if (bad) process.exit(1);
