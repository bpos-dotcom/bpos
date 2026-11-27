/**
 * La caja abierta (bpos_active_shift) es un solo documento que comparten
 * todos los equipos. Un equipo atrasado (por ejemplo un celular que no ha
 * bajado los cambios) NO puede subir su copia vieja encima de la de la nube:
 * así fue como el 26 nov un celular regresó la caja del día anterior (ya
 * cortada) y la caja siguió vendiendo en ese turno.
 *
 * Regla: si la nube cambió desde la última vez que este equipo la vio (otro
 * equipo abrió, cerró o cambió la caja), gana la nube y este equipo se queda
 * con ella. Si es el mismo turno, se conserva el número de pedido más alto
 * para que no se repitan folios.
 */
export type ShiftDoc = { sessionId?: unknown; orderCounter?: unknown; [key: string]: unknown } | null;

export type ShiftDecision =
  /** subir lo de este equipo (puede venir ajustado) */
  | { action: "push"; value: ShiftDoc }
  /** no subir: este equipo se queda con lo de la nube (null = caja cerrada) */
  | { action: "adopt"; value: ShiftDoc };

/**
 * local: lo que tiene este equipo (null = cerrada aquí)
 * cloud: lo que hay en la nube (null = cerrada o nunca abierta)
 * cloudChanged: la nube ya no es la que este equipo vio la última vez
 */
export function resolveShiftPush(local: ShiftDoc, cloud: ShiftDoc, cloudChanged: boolean): ShiftDecision {
  if (!cloudChanged) return { action: "push", value: local };
  // Otro equipo cerró la caja: aquí también queda cerrada
  if (!cloud) return { action: "adopt", value: null };
  // Aquí se cerró y otro equipo abrió una nueva: se queda la nueva
  if (!local) return { action: "adopt", value: cloud };
  if (local.sessionId && local.sessionId === cloud.sessionId) {
    // Mismo turno cambiado en dos equipos: lo de la nube con el número de pedido más alto
    const counter = Math.max(Number(local.orderCounter) || 0, Number(cloud.orderCounter) || 0);
    if (counter === (Number(cloud.orderCounter) || 0)) return { action: "adopt", value: cloud };
    return { action: "push", value: { ...cloud, orderCounter: counter } };
  }
  // Otro turno: el de este equipo es viejo
  return { action: "adopt", value: cloud };
}
