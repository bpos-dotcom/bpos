/**
 * Pedidos del menú digital con la caja apagada:
 *  - El aviso al celular del negocio (lo arma el servidor, no la caja).
 *  - Aceptar con la caja cerrada: queda "aceptado" sin venta; al abrir la
 *    caja se crea la venta una sola vez (aunque haya dos equipos), con el
 *    envío cotizado y sin cobrarla dos veces.
 *   npx tsx scripts/test-pedidos-caja-apagada.ts
 */
import Module from "node:module";
import path from "node:path";
import type { Product } from "@/data/products";

// ---------------------------------------------------------------- navegador falso
const store = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  key: () => null,
  length: 0,
};
g.window = { dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined, location: { pathname: "/pos", origin: "http://localhost" }, localStorage: g.localStorage };
g.CustomEvent = class {
  constructor(public type: string, public init?: unknown) {}
};

// ---------------------------------------------------------------- Supabase falso (una tabla: bpos_online_orders)
type Row = { id: string; folio: string; token: string; account_id: null; status: string; data: Record<string, unknown>; sale_order_id: number | null; eta_minutes: number | null; reason: string | null; created_at: string; updated_at: string };
const rows = new Map<string, Row>();

function query(table: string) {
  let patch: Partial<Row> | null = null;
  const filters: ((r: Row) => boolean)[] = [];
  let single = false;
  const b = {
    select: () => b,
    update: (p: Partial<Row>) => ((patch = p), b),
    eq: (col: keyof Row, v: unknown) => (filters.push((r) => r[col] === v), b),
    neq: (col: keyof Row, v: unknown) => (filters.push((r) => r[col] !== v), b),
    lt: () => b,
    like: () => b,
    limit: () => b,
    order: () => b,
    or: (expr: string) => {
      // Solo el filtro de "apartar la venta": sin venta, o apartado hace más de 2 min
      const stale = /updated_at\.lt\.([^)]+)\)/.exec(expr)?.[1];
      if (stale) filters.push((r) => r.sale_order_id === null || (r.sale_order_id === 0 && r.updated_at < stale));
      return b;
    },
    single: () => ((single = true), b),
    maybeSingle: () => ((single = true), b),
    then(resolve: (v: unknown) => void) {
      if (table !== "bpos_online_orders") return resolve({ data: single ? null : [], error: null, count: 0 });
      const hit = [...rows.values()].filter((r) => filters.every((f) => f(r)));
      if (patch) for (const r of hit) Object.assign(r, structuredClone(patch));
      const out = hit.map((r) => structuredClone(r));
      resolve({ data: single ? out[0] ?? null : out, error: null });
    },
  };
  return b;
}
const fakeSupabase = {
  from: (t: string) => query(t),
  rpc: async (fn: string, args: { p_id: string }) => {
    if (fn !== "bpos_online_claim") return { data: null, error: null };
    const r = rows.get(args.p_id);
    if (!r || r.status !== "nuevo") return { data: false, error: null };
    r.status = "aceptando";
    return { data: true, error: null };
  },
};

// Módulos con red o impresoras: versiones de prueba
const printed: string[] = [];
const fakes: Record<string, unknown> = {
  "lib/supabase/client.ts": { getSupabase: () => fakeSupabase, isCloudConfigured: true, SUPABASE_URL: "http://x", SUPABASE_KEY: "x" },
  "lib/bridge/sale-tickets.ts": { printSale: async (sale: { id: number }) => (printed.push(String(sale.id)), []), saleStations: () => [] },
  "lib/agent/client.ts": { agentScope: async () => ({ businessId: "b", branchId: "s" }) },
  "lib/cloud/sync.ts": { isPrimaryDevice: () => true },
};
const root = path.resolve(__dirname, "..");
const M = Module as unknown as { _resolveFilename: (r: string, p: unknown, ...a: unknown[]) => string; _load: (r: string, p: unknown, ...a: unknown[]) => unknown };
const load = M._load;
M._load = function (request: string, parent: unknown, ...rest: unknown[]) {
  let file = "";
  try {
    file = path.relative(root, M._resolveFilename(request, parent, ...rest)).replace(/\\/g, "/");
  } catch {}
  if (fakes[file]) return fakes[file];
  return load.call(this, request, parent, ...rest);
};

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

const products: Product[] = [
  { id: 2, name: "Burger", category: "Burgers", price: 99, emoji: "🍔", station: "Parrilla" },
  { id: 5, name: "Papas", category: "Extras", price: 45, emoji: "🍟", station: "Freidora" },
];

function newOrder(id: string, data: Record<string, unknown> = {}): Row {
  const now = new Date().toISOString();
  return {
    id,
    folio: id.slice(0, 4).toUpperCase(),
    token: "t",
    account_id: null,
    status: "nuevo",
    sale_order_id: null,
    eta_minutes: null,
    reason: null,
    created_at: now,
    updated_at: now,
    data: {
      type: "Recoger",
      customer: { name: "Ana", phone: "8710000000", address: "", reference: "" },
      payment: "Efectivo",
      note: "",
      lines: [
        { productId: 2, name: "Burger", quantity: 2, unitPrice: 1, picks: {}, summary: "" },
        { productId: 5, name: "Papas", quantity: 1, unitPrice: 45, picks: {}, summary: "" },
      ],
      subtotal: 243,
      deliveryFee: 0,
      total: 243,
      ...data,
    },
  };
}

async function main() {
  const { onlineOrderPush, DEFAULT_PUSH_PREFS } = await import("@/lib/push/rules");
  const oo = await import("@/lib/online-orders");
  store.set("bpos_products", JSON.stringify(products));
  store.set("bpos_digital_menu", JSON.stringify({ soldOut: {}, hidden: [], deliveryFee: 30 }));

  // ------------------------------------------------ aviso al celular
  const base = { id: "a1", folio: "K7PQ", status: "nuevo", data: { type: "Domicilio", payment: "Efectivo", total: 243, customer: { name: "Ana" }, lines: [{ quantity: 2 }, { quantity: 1 }] } };
  const push = onlineOrderPush(base);
  check("aviso de pedido nuevo", Boolean(push) && push!.title.includes("K7PQ") && push!.title.includes("$243"), push);
  check("aviso dice quién, cómo y cuántos", Boolean(push?.body.includes("Ana · a domicilio · 3 productos")), push?.body);
  check("aviso abre Pedidos en línea", push?.url === "/pedidos-en-linea");
  check("Mercado Pago sin pagar: no avisa todavía", onlineOrderPush({ ...base, data: { ...base.data, payment: "Mercado Pago" } }) === null);
  check("Mercado Pago pagado: sí avisa", onlineOrderPush({ ...base, data: { ...base.data, payment: "Mercado Pago", mp: { status: "approved" } } }) !== null);
  check("kiosco del local: no avisa", onlineOrderPush({ ...base, data: { ...base.data, kiosk: { eat: "aqui", screen: "1" } } }) === null);
  check("ya atendido: no avisa", onlineOrderPush({ ...base, status: "aceptado" }) === null);
  check("mesa con número", Boolean(onlineOrderPush({ ...base, data: { ...base.data, type: "Mesa", table: "4" } })?.body.includes("en mesa 4")));
  check("programado dice para cuándo", Boolean(onlineOrderPush({ ...base, data: { ...base.data, scheduledFor: "2026-11-22T20:00:00.000Z" } })?.body.includes("para el")));
  check("viene prendido de fábrica", DEFAULT_PUSH_PREFS.pedidosEnLinea === true);

  // ------------------------------------------------ caja cerrada: aceptar sin venta
  store.delete("bpos_active_shift");
  rows.set("o1", newOrder("o1"));
  let refused = "";
  try {
    await oo.acceptOnlineOrder(rows.get("o1") as never, 20, "Dueño");
  } catch (e) {
    refused = (e as Error).message;
  }
  check("aceptar normal con caja cerrada se niega", refused.includes("Abre la caja"), refused);
  check("pero el pedido sigue nuevo", rows.get("o1")!.status === "nuevo");

  await oo.acceptOnlineOrderLater(rows.get("o1") as never, 20, "Dueño");
  const r1 = rows.get("o1")!;
  check("aceptado con la caja cerrada", r1.status === "aceptado" && r1.eta_minutes === 20, r1.status);
  check("todavía sin venta", r1.sale_order_id === null);
  check("queda marcado para crear la venta", (r1.data.saleLater as { by?: string })?.by === "Dueño");
  check("espera su venta", oo.waitingSale(r1 as never));
  check("no se crea venta en el navegador", !store.get("bpos_orders"));

  let twice = "";
  try {
    await oo.acceptOnlineOrderLater(rows.get("o1") as never, 20, "Otro");
  } catch (e) {
    twice = (e as Error).message;
  }
  check("otro dispositivo no lo vuelve a aceptar", twice.includes("Otro dispositivo"), twice);

  let closed = "";
  try {
    await oo.createPendingOnlineSale(rows.get("o1") as never);
  } catch (e) {
    closed = (e as Error).message;
  }
  check("sin caja abierta no se crea la venta", closed.includes("Abre la caja"), closed);

  // ------------------------------------------------ se abre la caja: se crea la venta una vez
  store.set("bpos_active_shift", JSON.stringify({ sessionId: "turno-1", openedAt: new Date().toISOString(), openingCash: 0, openedBy: { name: "Cajero" } }));
  const sale = await oo.createPendingOnlineSale(rows.get("o1") as never);
  const saved = JSON.parse(store.get("bpos_orders") || "[]") as { id: number; total: number; onlineOrderId?: string; shiftSessionId?: string; pendingPayment?: boolean; items: unknown[] }[];
  check("al abrir la caja se crea la venta", Boolean(sale) && saved.length === 1, saved.length);
  check("con precios de B-POS (2 × 99 + 45)", saved[0]?.total === 243, saved[0]?.total);
  check("en el turno que se abrió", saved[0]?.shiftSessionId === "turno-1", saved[0]?.shiftSessionId);
  check("queda por cobrar (paga al recoger)", saved[0]?.pendingPayment === true);
  check("ligada al pedido en línea", saved[0]?.onlineOrderId === "o1");
  check("el pedido ya tiene su venta", rows.get("o1")!.sale_order_id === saved[0]?.id, rows.get("o1")!.sale_order_id);
  check("sigue aceptado", rows.get("o1")!.status === "aceptado");
  check("ya no espera venta", !oo.waitingSale(rows.get("o1") as never));
  check("se imprimieron sus comandas", printed.includes(String(saved[0]?.id)), printed);
  const again = await oo.createPendingOnlineSale({ ...rows.get("o1")!, sale_order_id: null } as never);
  check("no se crea dos veces (aunque otro equipo lo vea viejo)", again === null && JSON.parse(store.get("bpos_orders") || "[]").length === 1);

  // Dos equipos a la vez: solo uno lo toma
  rows.set("o2", newOrder("o2"));
  store.delete("bpos_active_shift");
  await oo.acceptOnlineOrderLater(rows.get("o2") as never, 15, "Dueño");
  store.set("bpos_active_shift", JSON.stringify({ sessionId: "turno-1", openedAt: new Date().toISOString(), openingCash: 0, openedBy: { name: "Cajero" } }));
  const snapshot = structuredClone(rows.get("o2")!);
  rows.get("o2")!.sale_order_id = 0; // otro equipo lo acaba de apartar
  rows.get("o2")!.updated_at = new Date().toISOString();
  check("si otro equipo lo apartó, este no lo crea", (await oo.createPendingOnlineSale(snapshot as never)) === null);
  rows.get("o2")!.updated_at = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // ese equipo se apagó a medias
  check("apartado hace 5 min sin terminar: otro lo toma", Boolean(await oo.createPendingOnlineSale({ ...snapshot, sale_order_id: 0 } as never)));

  // Envío cotizado con la caja cerrada: el costo que puso al aceptar va en la venta
  store.delete("bpos_active_shift");
  rows.set("o3", newOrder("o3", { type: "Domicilio", deliveryQuote: true, customer: { name: "Luis", phone: "8711111111", address: "Calle 1", reference: "" } }));
  await oo.acceptOnlineOrderLater(rows.get("o3") as never, 30, "Dueño", { deliveryFee: 40 });
  check("cliente ve su total con envío", rows.get("o3")!.data.total === 283 && rows.get("o3")!.data.deliveryFee === 40, rows.get("o3")!.data.total);
  store.set("bpos_active_shift", JSON.stringify({ sessionId: "turno-2", openedAt: new Date().toISOString(), openingCash: 0, openedBy: { name: "Cajero" } }));
  const s3 = await oo.createPendingOnlineSale(rows.get("o3") as never);
  check("la venta lleva el envío cotizado", s3?.sale.total === 283 && (s3?.sale as { deliveryFee?: number }).deliveryFee === 40, s3?.sale.total);

  // Producto que ya no existe al abrir la caja: se guarda el motivo y no se reintenta solo
  store.delete("bpos_active_shift");
  rows.set("o4", newOrder("o4"));
  await oo.acceptOnlineOrderLater(rows.get("o4") as never, 20, "Dueño");
  store.set("bpos_products", JSON.stringify([]));
  store.set("bpos_active_shift", JSON.stringify({ sessionId: "turno-2", openedAt: new Date().toISOString(), openingCash: 0, openedBy: { name: "Cajero" } }));
  let failed = "";
  try {
    await oo.createPendingOnlineSale(rows.get("o4") as never);
  } catch (e) {
    failed = (e as Error).message;
  }
  const r4 = rows.get("o4")!;
  check("si no se puede crear, se guarda el motivo", Boolean((r4.data.saleLater as { error?: string }).error) && failed.length > 0, r4.data.saleLater);
  check("y vuelve a quedar sin venta (no se queda apartado)", r4.sale_order_id === null);
  store.set("bpos_products", JSON.stringify(products));
  await oo.retryPendingOnlineSale(r4 as never);
  check("volver a intentar quita el motivo", !(rows.get("o4")!.data.saleLater as { error?: string }).error);
  check("y ahora sí se crea", Boolean(await oo.createPendingOnlineSale(rows.get("o4") as never)));

  // Rechazado después de aceptarlo: ya no espera venta
  check("rechazado no espera venta", !oo.waitingSale({ status: "rechazado", sale_order_id: null, data: { saleLater: { at: "", by: "" } } } as never));

  console.log(`\n${ok} bien, ${bad} mal`);
  if (bad) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
