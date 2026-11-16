/**
 * Cancelar el inventario ciego (no se hizo): el programado que nadie empezó,
 * uno empezado y uno pedido por el dueño. Queda "cancelado", no vuelve a
 * salir ni a sonar ese día y le avisa al dueño.
 *   npx tsx scripts/test-cancelar-inventario-ciego.ts
 */
export {};

const store = new Map<string, string>();
const g = globalThis as unknown as { window: unknown; localStorage: unknown; Event: unknown };
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};
g.window = { dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined, setInterval: () => 0, clearInterval: () => undefined };
if (typeof Event === "undefined") g.Event = class { constructor(public type: string) {} };

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

async function main() {
  const p = await import("@/lib/productivity");
  const { pushMessage } = await import("@/lib/push/rules");

  // Programado todos los días a las 11:00; hoy ya pasó la hora
  const today = new Date();
  store.set(p.SETTINGS_KEY, JSON.stringify({ blind: { ...p.DEFAULT_SETTINGS.blind, enabled: true, days: [0, 1, 2, 3, 4, 5, 6], time: "00:00", scope: "todo" } }));
  store.set("bpos_inventory", JSON.stringify([{ id: 1, name: "Pan", unit: "pza", stock: 10, minStock: 0 }, { id: 2, name: "Carne", unit: "pza", stock: 5, minStock: 0 }]));

  const scheduled = p.pendingBlind(today);
  check("el de hoy está pendiente (sin registro todavía)", Boolean(scheduled && !scheduled.count), scheduled);

  // 1) El programado que nadie empezó
  const c1 = p.cancelBlind({ slot: scheduled!.slot }, "Admin");
  check("queda cancelado con quién lo canceló", c1.status === "cancelado" && c1.cancelledBy === "Admin" && Boolean(c1.cancelledAt));
  check("ya no vuelve a salir hoy", p.pendingBlind(today) === null, p.pendingBlind(today));
  check("queda en la auditoría (con quién)", (store.get("bpos_audit_log") || "").includes("blind.cancelled") && (store.get("bpos_audit_log") || "").includes("Admin canceló"));

  // 2) Uno empezado con algo contado
  store.set(p.BLIND_KEY, "[]");
  const started = p.startBlind();
  p.setBlindLine(started.id, 1, 8);
  check("empezado: en curso", p.pendingBlind(today)?.count?.status === "en curso");
  const c2 = p.cancelBlind({ countId: started.id, slot: started.slot }, "Admin");
  check("empezado: cancelado", c2.status === "cancelado" && c2.id === started.id);
  check("empezado: no vuelve a salir", p.pendingBlind(today) === null);
  let threw = false;
  try {
    p.cancelBlind({ countId: started.id }, "Admin");
  } catch {
    threw = true;
  }
  check("no se cancela dos veces", threw);
  let cannotStart = false;
  try {
    p.startBlind();
  } catch {
    cannotStart = true;
  }
  check("cancelado: ya no se puede empezar hoy", cannotStart);

  // 3) Pedido por el dueño (forma vieja: solo el id)
  store.set(p.SETTINGS_KEY, JSON.stringify({ blind: { ...p.DEFAULT_SETTINGS.blind, enabled: false } }));
  store.set(p.BLIND_KEY, "[]");
  const asked = p.requestBlindNow();
  check("pedido por el dueño: pendiente", p.pendingBlind(today)?.count?.id === asked.id);
  p.cancelBlind(asked.id, "Dueño");
  check("pedido por el dueño: cancelado y ya no sale", p.pendingBlind(today) === null && p.getBlindCounts()[0].status === "cancelado");
  check("después se puede pedir otro", Boolean(p.requestBlindNow()));

  // Aviso al dueño
  const push = pushMessage({ event_id: "e1", action: "blind.cancelled", description: "Admin canceló el inventario ciego", metadata: {} }, {});
  check("aviso al dueño", Boolean(push && push.title.includes("cancelado")), push);
  check("se apaga con los avisos de productividad", pushMessage({ event_id: "e2", action: "blind.cancelled", description: "", metadata: {} }, { productividad: false }) === null);

  console.log(`\n${ok} bien, ${bad} con falla`);
  if (bad) process.exit(1);
}

void main();
