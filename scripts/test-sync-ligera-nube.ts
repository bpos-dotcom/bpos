/**
 * Sincronización ligera con una nube de mentiras (fetch falso que imita
 * a Supabase): este proceso es un equipo de B-POS y "el otro equipo"
 * escribe directo en la nube.
 *   npx tsx scripts/test-sync-ligera-nube.ts
 */
export {};

// ---------------------------------------------------------------- navegador falso
const store = new Map<string, string>();
class FakeStorage {
  getItem(k: string) {
    return store.has(k) ? store.get(k)! : null;
  }
  setItem(k: string, v: string) {
    store.set(k, String(v));
  }
  removeItem(k: string) {
    store.delete(k);
  }
  key(i: number) {
    return [...store.keys()][i] ?? null;
  }
  get length() {
    return store.size;
  }
  clear() {
    store.clear();
  }
}
const localStorage = new FakeStorage();
const g = globalThis as unknown as Record<string, unknown>;
g.Storage = FakeStorage;
g.localStorage = localStorage;
g.window = Object.assign(globalThis, {
  localStorage,
  location: { href: "http://localhost/", hash: "", search: "", origin: "http://localhost" },
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => true,
});
g.document = { visibilityState: "visible", addEventListener: () => undefined };
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
g.StorageEvent = class extends Event {
  constructor(type: string, init: Record<string, unknown>) {
    super(type);
    Object.assign(this, init);
  }
};
// Sin tiempo real de verdad (no se conecta a nada)
g.WebSocket = class {
  readyState = 0;
  constructor() {}
  send() {}
  close() {}
  addEventListener() {}
};

// ---------------------------------------------------------------- nube falsa
type DbRow = { business_id: string; scope: string; collection: string; record_id: string; data: unknown; deleted: boolean; seq: number; updated_by: string };
const db = new Map<string, DbRow>();
let seq = 1000;
const keyOf = (r: { business_id: string; scope: string; collection: string; record_id: string }) => `${r.business_id}|${r.scope}|${r.collection}|${r.record_id}`;
const traffic = { dataRows: 0, dataBytes: 0, seqOnly: 0, legacyDownloaded: 0, upserts: 0 };

function cloudWrite(row: Omit<DbRow, "seq">, forceSeq?: number) {
  const r = { ...row, seq: forceSeq ?? ++seq };
  db.set(keyOf(r), r);
  return r;
}

function parseList(v: string) {
  return v
    .replace(/^\(|\)$/g, "")
    .split(",")
    .map((s) => s.replace(/^"|"$/g, ""));
}

function matches(row: DbRow, params: URLSearchParams) {
  for (const [field, raw] of params.entries()) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(field)) continue;
    const value = String((row as unknown as Record<string, unknown>)[field]);
    const conds = params.getAll(field);
    for (const cond of conds) {
      if (cond.startsWith("eq.") && value !== cond.slice(3)) return false;
      if (cond.startsWith("in.") && !parseList(cond.slice(3)).includes(value)) return false;
      if (cond.startsWith("not.in.") && parseList(cond.slice(7)).includes(value)) return false;
      if (cond.startsWith("gt.") && !(Number(value) > Number(cond.slice(3)))) return false;
      if (cond.startsWith("gte.") && !(Number(value) >= Number(cond.slice(4)))) return false;
      if (cond.startsWith("lte.") && !(Number(value) <= Number(cond.slice(4)))) return false;
    }
    void raw;
  }
  return true;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

g.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (!url.pathname.startsWith("/rest/v1/sync_records")) return json({});
  const params = url.searchParams;
  const method = (init?.method || "GET").toUpperCase();
  const select = params.get("select") || "*";
  if (method === "POST") {
    const body = JSON.parse(String(init?.body)) as Omit<DbRow, "seq">[];
    traffic.upserts += body.length;
    const out = body.map((r) => cloudWrite(r));
    return json(select === "seq" ? out.map((r) => ({ seq: r.seq })) : out, 201);
  }
  let rows = [...db.values()].filter((r) => matches(r, params)).sort((a, b) => a.seq - b.seq);
  const limit = Number(params.get("limit") || 0);
  if (limit) rows = rows.slice(0, limit);
  if (select === "seq") {
    traffic.seqOnly += rows.length;
    return json(rows.map((r) => ({ seq: r.seq })));
  }
  const out = rows.map((r) => ({ collection: r.collection, record_id: r.record_id, data: r.data, deleted: r.deleted, seq: r.seq }));
  traffic.dataRows += out.length;
  traffic.dataBytes += JSON.stringify(out).length;
  traffic.legacyDownloaded += out.filter((r) => r.collection === "bpos_inventory_kardex").length;
  return json(out);
};

// ---------------------------------------------------------------- pruebas
let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};
const resetTraffic = () => Object.keys(traffic).forEach((k) => ((traffic as Record<string, number>)[k] = 0));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const BIZ = "biz-1";
const BRANCH = "branch-1";
const at = (h: number, m = 0) => new Date(2026, 10, 18, h, m).toISOString();
const move = (id: string, ingredientId: number, h: number, m = 0) => ({ id, ingredientId, createdAt: at(h, m), quantity: 1, type: "venta" });
// id real de un renglón (como lo calcula cualquier equipo)
const rid = (m: { id: string; ingredientId: number; createdAt: string }) => `${m.id}~${m.ingredientId}~${m.createdAt}`;
const kardexOf = () => JSON.parse(store.get("bpos_inventory_kardex") || "[]") as { id: string; ingredientId: number }[];

async function main() {
  // Equipo con la versión anterior: kardex como documento, ya sincronizado
  const kardex0 = [move("s1", 1, 10), move("s1", 2, 10), move("s2", 1, 11)];
  const legacy = cloudWrite({ business_id: BIZ, scope: BRANCH, collection: "bpos_inventory_kardex", record_id: "__doc__", data: kardex0, deleted: false, updated_by: "viejo" });
  cloudWrite({ business_id: BIZ, scope: BRANCH, collection: "bpos_orders", record_id: "o1", data: { id: "o1", total: 100, createdAt: at(10) }, deleted: false, updated_by: "x" });
  store.set("bpos_inventory_kardex", JSON.stringify(kardex0));
  store.set("bpos_orders", JSON.stringify([{ id: "o1", total: 100, createdAt: at(10) }]));
  store.set("bpos_device_role", "primary");
  store.set("bpos_sync_meta", JSON.stringify({ businessId: BIZ, branchId: BRANCH, lastSeq: seq }));
  store.set("bpos_sync_shadow", JSON.stringify({ bpos_inventory_kardex: { __doc__: "viejo" } }));
  store.set("bpos_sync_dirty", "[]");

  const sync = await import("@/lib/cloud/sync");
  const acc = { status: "ready", businessId: BIZ, branchId: BRANCH } as unknown as Parameters<typeof sync.startSync>[0];
  resetTraffic();
  sync.startSync(acc);
  await wait(50);
  await sync.flush();
  await sync.pull();

  const rowsInCloud = [...db.values()].filter((r) => r.collection === "rows:bpos_inventory_kardex" && !r.deleted);
  check("la caja principal sube su kardex renglón por renglón (3)", rowsInCloud.length === 3, rowsInCloud.length);
  check("el documento viejo NO se borra (lo usan los equipos sin actualizar)", !db.get(keyOf(legacy))!.deleted);
  check("el kardex local sigue igual (3)", kardexOf().length === 3, kardexOf().length);

  // Otro equipo actualizado agrega una venta (2 renglones)
  resetTraffic();
  cloudWrite({ business_id: BIZ, scope: BRANCH, collection: "rows:bpos_inventory_kardex", record_id: rid(move("s3", 1, 12)), data: move("s3", 1, 12), deleted: false, updated_by: "otro" });
  cloudWrite({ business_id: BIZ, scope: BRANCH, collection: "rows:bpos_inventory_kardex", record_id: rid(move("s3", 4, 12)), data: move("s3", 4, 12), deleted: false, updated_by: "otro" });
  await sync.pull();
  check("llega la venta del otro equipo: 5 renglones", kardexOf().length === 5, kardexOf().length);
  check("solo se bajaron los 2 renglones nuevos", traffic.dataRows === 2, traffic.dataRows);

  // Un equipo SIN actualizar vuelve a subir su documento completo
  resetTraffic();
  cloudWrite({ business_id: BIZ, scope: BRANCH, collection: "bpos_inventory_kardex", record_id: "__doc__", data: [...kardex0, move("vieja", 9, 13)], deleted: false, updated_by: "viejo" });
  await sync.pull();
  check("el documento del equipo viejo no se baja", traffic.legacyDownloaded === 0 && traffic.dataRows === 0, traffic);
  check("ni se mezcla con el kardex", kardexOf().length === 5);

  // Esta caja registra una venta: sube solo ese renglón y no se lo vuelve a bajar
  resetTraffic();
  localStorage.setItem("bpos_inventory_kardex", JSON.stringify([...kardexOf(), move("s4", 2, 14)]));
  await wait(600);
  await sync.flush();
  check("sube solo 1 renglón (no el kardex entero)", traffic.upserts === 1, traffic.upserts);
  await sync.pull();
  await sync.pull();
  await sync.pull();
  check("su propio cambio no se vuelve a bajar", traffic.dataRows === 0, traffic.dataRows);
  check("las revisiones solo piden números", traffic.seqOnly > 0);

  // Un cambio que llegó tarde: su número se apartó antes, pero se guardó después de otro
  const reserved = ++seq;
  cloudWrite({ business_id: BIZ, scope: BRANCH, collection: "bpos_orders", record_id: "o-antes", data: { id: "o-antes", total: 10, createdAt: at(15) }, deleted: false, updated_by: "otro" });
  await sync.pull();
  resetTraffic();
  cloudWrite({ business_id: BIZ, scope: BRANCH, collection: "bpos_orders", record_id: "o-tarde", data: { id: "o-tarde", total: 50, createdAt: at(15) }, deleted: false, updated_by: "otro" }, reserved);
  await sync.pull();
  const orders = JSON.parse(store.get("bpos_orders")!) as { id: string }[];
  check("el pedido que llegó tarde sí entra", orders.some((o) => o.id === "o-tarde"), orders.map((o) => o.id));
  check("y se bajó solo ese", traffic.dataRows === 1, traffic.dataRows);

  // Los pedidos siguen sincronizando normal
  resetTraffic();
  cloudWrite({ business_id: BIZ, scope: BRANCH, collection: "bpos_orders", record_id: "o2", data: { id: "o2", total: 80, createdAt: at(16) }, deleted: false, updated_by: "otro" });
  await sync.pull();
  check("pedido nuevo de otro equipo llega", (JSON.parse(store.get("bpos_orders")!) as { id: string }[]).some((o) => o.id === "o2"));

  // El kardex viejo que se va a la nube se borra renglón por renglón en los demás
  resetTraffic();
  cloudWrite({ business_id: BIZ, scope: BRANCH, collection: "rows:bpos_inventory_kardex", record_id: rid(move("s3", 4, 12)), data: null, deleted: true, updated_by: "otro" });
  await sync.pull();
  check("borrado de un renglón: queda 5 (6 - 1)", kardexOf().length === 5, kardexOf().length);

  console.log(`\n${ok} bien, ${bad} mal`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
