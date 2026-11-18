/**
 * Memoria del navegador llena ("Setting the value of 'bpos_audit_log'
 * exceeded the quota"): la auditoría y los avisos nunca deben trabar la caja.
 *   npx tsx scripts/test-memoria-llena.ts
 */
export {};

const store = new Map<string, string>();
let limit = Infinity; // letras que caben en total
const used = () => [...store.entries()].reduce((s, [k, v]) => s + k.length + v.length, 0);
const g = globalThis as unknown as { window: unknown; localStorage: unknown; Event: unknown };
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    const before = store.get(k);
    store.set(k, String(v));
    if (used() > limit) {
      if (before === undefined) store.delete(k);
      else store.set(k, before);
      const e = new Error(`Failed to execute 'setItem' on 'Storage': Setting the value of '${k}' exceeded the quota.`);
      e.name = "QuotaExceededError";
      throw e;
    }
  },
  removeItem: (k: string) => void store.delete(k),
};
g.window = { dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined, localStorage: g.localStorage };
if (typeof Event === "undefined") g.Event = class { constructor(public type: string) {} };

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

async function main() {
  const { addAuditEvent } = await import("@/lib/audit");
  const { keepAlerts } = await import("@/lib/notifications/operationsCenter");

  // 3000 eventos viejos: se quedan solo 1000
  store.set("bpos_audit_log", JSON.stringify(Array.from({ length: 3000 }, (_, i) => ({ id: `a${i}`, category: "x", action: "x", description: "evento viejo ".repeat(10), createdAt: new Date(2026, 9, 1).toISOString() }))));
  addAuditEvent({ category: "venta", action: "sale.created", description: "venta" });
  const n = JSON.parse(store.get("bpos_audit_log")!).length;
  check("la auditoría de la caja se queda en 1000", n === 1000, n);

  // Memoria llena: no truena, guarda menos y el evento nuevo queda
  limit = used() - 20000;
  let threw = false;
  try {
    addAuditEvent({ category: "venta", action: "sale.created", description: "con memoria llena" });
  } catch {
    threw = true;
  }
  const after = JSON.parse(store.get("bpos_audit_log")!);
  check("con memoria llena NO truena", !threw);
  check("el evento nuevo sí se guardó", after[0]?.description === "con memoria llena");
  check("se guardaron menos para que quepa", after.length < 1000 && after.length >= 50, after.length);

  // Sin nada de espacio: tampoco truena
  limit = 10;
  threw = false;
  try {
    addAuditEvent({ category: "venta", action: "sale.created", description: "sin espacio" });
  } catch {
    threw = true;
  }
  check("sin nada de espacio tampoco truena", !threw);

  // Avisos: resueltos de más de una semana se van; pendientes se quedan
  const now = new Date("2026-11-18T12:00:00Z").getTime();
  const day = 86400000;
  const alerts = [
    { id: "p", status: "pending", createdAt: new Date(now - 30 * day).toISOString() },
    { id: "r-new", status: "resolved", createdAt: new Date(now - 2 * day).toISOString(), resolvedAt: new Date(now - day).toISOString() },
    { id: "r-old", status: "resolved", createdAt: new Date(now - 20 * day).toISOString(), resolvedAt: new Date(now - 10 * day).toISOString() },
  ] as never[];
  const kept = keepAlerts(alerts, now).map((a: { id: string }) => a.id);
  check("avisos: pendiente viejo se queda", kept.includes("p"));
  check("avisos: resuelto de ayer se queda", kept.includes("r-new"));
  check("avisos: resuelto de hace 10 días se va", !kept.includes("r-old"));
  check("avisos: máximo 200", keepAlerts(Array.from({ length: 500 }, (_, i) => ({ id: `x${i}`, status: "pending", createdAt: new Date(now).toISOString() })) as never[], now).length === 200);

  console.log(`\n${ok} bien, ${bad} mal`);
  if (bad) process.exit(1);
}
void main();
