/**
 * Caja local (B-POS en el programa del Agent, datos en el disco): lo que
 * hace la página para pasarse desde Chrome.
 *   npx tsx scripts/test-caja-local.ts
 * La parte del programa se prueba en Electron: bpos-agent/scripts/test-caja-local.js
 */
export {};

class FakeStorage {
  data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, String(v));
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}
const storage = new FakeStorage();
const g = globalThis as unknown as Record<string, unknown>;
g.window = Object.assign(globalThis, { localStorage: storage });

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

type Call = { url: string; body?: { entries: Record<string, string>; replace: boolean } };
const calls: Call[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: {} };
g.fetch = async (url: string, init?: { body?: string }) => {
  calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
  return { ok: reply.status < 300, status: reply.status, json: async () => reply.body } as unknown as Response;
};

async function main() {
  const m = await import("@/lib/caja-local");

  storage.setItem("bpos_orders", "[1,2]");
  storage.setItem("bpos_device_id", "dev-1");
  storage.setItem("sb-x-auth-token", "{}");
  storage.setItem(m.MOVED_KEY, "antes");
  const entries = m.collectEntries(storage);
  check("copia todo lo guardado", entries.bpos_orders === "[1,2]" && entries.bpos_device_id === "dev-1" && "sb-x-auth-token" in entries);
  check("sin la marca de 'ya se pasó'", !(m.MOVED_KEY in entries));
  storage.removeItem(m.MOVED_KEY);

  check("Chrome normal no es caja local", !m.isCajaLocal() && !m.movedToCajaLocal());

  reply = { status: 200, body: { service: "B-POS Agent", version: "2.0.24", cajaLocal: { version: 1, enabled: false, hasData: false, open: false } } };
  const info = await m.agentCajaInfo();
  check("detecta Agent con caja local", info?.version === 1);
  reply = { status: 200, body: { service: "B-POS Agent", version: "2.0.23" } };
  check("Agent viejo: no se ofrece", (await m.agentCajaInfo()) === null);

  reply = { status: 409, body: { success: false, conflict: true, error: "La caja local ya tiene datos." } };
  const conflict = await m.moveToCajaLocal();
  check("ya tenía datos: pregunta antes de reemplazar", !conflict.ok && "conflict" in conflict && conflict.conflict === true);
  check("y no marca este navegador", !m.movedToCajaLocal());

  reply = { status: 200, body: { success: true, count: 3 } };
  const moved = await m.moveToCajaLocal({ replace: true });
  const last = calls[calls.length - 1];
  check("manda todo al Agent", last.url.endsWith("/caja-local/import") && last.body?.replace === true && last.body.entries.bpos_orders === "[1,2]");
  check("se pasó", moved.ok && moved.count === 3);
  check("este navegador queda marcado", m.movedToCajaLocal());

  g.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  const down = await m.moveToCajaLocal();
  check("sin Agent: mensaje claro", !down.ok && /B-POS Agent/.test(down.error));
  check("abrir sin Agent: false", (await m.openCajaLocal()) === false);

  // En la ventana del programa: ya es caja local y nunca se bloquea
  Object.defineProperty(globalThis, "bposCajaLocal", { value: { version: 1 }, configurable: true });
  check("en el programa: es caja local", m.isCajaLocal());
  check("en el programa: nunca dice 'ya se pasó'", !m.movedToCajaLocal());

  console.log(`\n${ok} bien, ${bad} mal`);
  if (bad) process.exit(1);
}
void main();
