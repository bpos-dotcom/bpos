/**
 * Eliminar un inventario ciego ya subido (contaron mal) y compras registradas
 * tarde (la mercancía ya estaba en el local cuando contaron).
 *   npx tsx scripts/test-eliminar-inventario-ciego.ts
 */
export {};

const store = new Map<string, string>();
const g = globalThis as unknown as { window: unknown; localStorage: unknown; Event: unknown; CustomEvent: unknown };
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};
g.window = { dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined, setInterval: () => 0, clearInterval: () => undefined };
if (typeof Event === "undefined") g.Event = class { constructor(public type: string) {} };
if (typeof CustomEvent === "undefined") g.CustomEvent = class { constructor(public type: string, public detail?: unknown) {} };

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const p = await import("@/lib/productivity");
  const { getInventory, getKardex } = await import("@/lib/inventory");
  const stock = (id: number) => Number(getInventory().find((i) => Number(i.id) === id)?.stock);

  store.set(p.SETTINGS_KEY, JSON.stringify({ blind: { ...p.DEFAULT_SETTINGS.blind, enabled: false, scope: "todo" } }));
  const reset = (papas: number, pan: number) => {
    store.set("bpos_inventory", JSON.stringify([{ id: 5, name: "Papas", unit: "kg", stock: papas, minimum: 0 }, { id: 7, name: "Pan", unit: "pza", stock: pan, minimum: 0 }]));
    store.set("bpos_inventory_kardex", "[]");
    store.set("bpos_purchases", "[]");
    store.set(p.BLIND_KEY, "[]");
  };
  const count = (papas: number | null, pan: number | null) => {
    const c = p.requestBlindNow();
    const started = p.startBlind();
    check("se empieza el que pidió el dueño", started.id === c.id);
    if (papas !== null) p.setBlindLine(started.id, 5, papas);
    if (pan !== null) p.setBlindLine(started.id, 7, pan);
    return p.submitBlind(started.id);
  };

  // 1) Contaron mal, ya se ajustó: eliminar regresa el inventario a como estaba
  reset(50, 20);
  const c1 = count(21, 20);
  check("papas: faltan 29", p.blindRows(c1).find((r) => r.ingredientId === 5)?.diff === -29);
  p.adjustBlindToCounted(c1.id);
  check("ajustado: papas en 21", stock(5) === 21, stock(5));
  check("guarda lo que se aplicó", JSON.stringify(p.getBlindCounts()[0].applied) === JSON.stringify([{ ingredientId: 5, delta: -29 }]), p.getBlindCounts()[0].applied);
  const r1 = p.annulBlind(c1.id, "Dueño", "contaron mal");
  check("eliminado: deshizo 1 insumo", r1.reverted === 1);
  check("eliminado: papas regresan a 50", stock(5) === 50, stock(5));
  check("eliminado: pan no se toca (cuadraba)", stock(7) === 20);
  check("queda 'anulado' con quién y por qué", r1.count.status === "anulado" && r1.count.annulledBy === "Dueño" && r1.count.annulReason === "contaron mal");
  check("movimiento en el Kardex con el motivo", getKardex().some((m) => m.type === "Ajuste positivo" && m.quantity === 29 && /Se eliminó el inventario ciego.*contaron mal/.test(m.reason || "")));
  check("queda en la auditoría", (store.get("bpos_audit_log") || "").includes("blind.annulled"));
  let twice = false;
  try {
    p.annulBlind(c1.id, "Dueño");
  } catch {
    twice = true;
  }
  check("no se elimina dos veces", twice);
  check("después se puede pedir otro", Boolean(count(30, 20)));

  // 2) Ajustado con la versión anterior (sin 'applied'): se deshace con las diferencias
  reset(50, 20);
  const c2 = count(40, 22);
  p.adjustBlindToCounted(c2.id);
  const list = p.getBlindCounts().map((c) => (c.id === c2.id ? { ...c, applied: undefined } : c));
  store.set(p.BLIND_KEY, JSON.stringify(list));
  check("ajustado viejo: papas 40 y pan 22", stock(5) === 40 && stock(7) === 22);
  const r2 = p.annulBlind(c2.id, "Dueño");
  check("ajustado viejo: deshace los 2", r2.reverted === 2 && stock(5) === 50 && stock(7) === 20, { reverted: r2.reverted, papas: stock(5), pan: stock(7) });

  // 3) Subido y sin revisar, o "dejar como está": eliminar no mueve el inventario
  reset(50, 20);
  const c3 = count(10, 20);
  const r3 = p.annulBlind(c3.id, "Dueño");
  check("sin ajustar: no mueve nada", r3.reverted === 0 && stock(5) === 50);
  reset(50, 20);
  const c4 = count(10, 20);
  p.dismissBlind(c4.id);
  check("revisado: no mueve nada", p.annulBlind(c4.id, "Dueño").reverted === 0 && stock(5) === 50);
  let pendingThrows = false;
  reset(50, 20);
  const open = p.requestBlindNow();
  try {
    p.annulBlind(open.id, "Dueño");
  } catch {
    pendingThrows = true;
  }
  check("uno pendiente no se 'elimina' (se cancela)", pendingThrows);

  // 4) Compra registrada después de contar, pero la mercancía ya estaba
  reset(27, 20);
  const c5 = count(60, 20); // contaron 60: incluye 48 kg que llegaron el sábado y no estaban registrados
  await sleep(5);
  const purchase = { id: "compra-1", folio: "C-000036", supplier: "Proveedor", createdAt: new Date().toISOString(), status: "confirmed", items: [{ id: "i1", ingredientId: 5, ingredientName: "Papas", purchasedQuantity: 3, inventoryQuantity: 48, unit: "kg", lineTotal: 1500 }], subtotal: 1500, tax: 0, total: 1500, source: "manual" };
  store.set("bpos_purchases", JSON.stringify([purchase]));
  store.set("bpos_inventory", JSON.stringify([{ id: 5, name: "Papas", unit: "kg", stock: 75, minimum: 0 }, { id: 7, name: "Pan", unit: "pza", stock: 20, minimum: 0 }]));
  const late = p.blindLatePurchases(c5);
  check("detecta la compra registrada después de contar", late.length === 1 && late[0].folio === "C-000036" && late[0].items[0].quantity === 48, late);
  check("solo con lo que se contó (no el pan)", late[0].items.every((i) => i.ingredientId === 5));
  check("sin marcarla: sobran 33 (la contaría dos veces)", p.blindRows(c5, []).find((r) => r.ingredientId === 5)?.diff === 33);
  const withIt = p.blindRows(c5, ["compra-1"]).find((r) => r.ingredientId === 5)!;
  check("marcada: faltan 15 y el sistema incluye la compra", withIt.diff === -15 && withIt.late === 48, withIt);
  p.adjustBlindToCounted(c5.id, ["compra-1"]);
  check("ajustado con la compra: papas en 60 (lo contado)", stock(5) === 60, stock(5));
  check("recuerda qué compras se tomaron", JSON.stringify(p.getBlindCounts().find((c) => c.id === c5.id)?.latePurchases) === JSON.stringify(["compra-1"]));
  check("el reporte guardado sigue mostrando la compra", p.blindRows(p.getBlindCounts().find((c) => c.id === c5.id)!).find((r) => r.ingredientId === 5)?.late === 48);
  p.annulBlind(c5.id, "Dueño");
  check("eliminado: regresa a 75 (con la compra)", stock(5) === 75, stock(5));

  // 5) Compra registrada ANTES de contar ese insumo: ya va en lo que decía el sistema
  reset(27, 20);
  const asked = p.requestBlindNow();
  const st = p.startBlind();
  store.set("bpos_purchases", JSON.stringify([{ ...purchase, createdAt: new Date().toISOString() }]));
  await sleep(5);
  p.setBlindLine(st.id, 5, 70);
  const c6 = p.submitBlind(st.id);
  check("compra antes de contar: no sale como tardía", asked.id === c6.id && p.blindLatePurchases(c6).length === 0);
  const cancelled = { ...purchase, id: "compra-2", status: "cancelled", createdAt: new Date(Date.now() + 1000).toISOString() };
  store.set("bpos_purchases", JSON.stringify([cancelled]));
  check("compra cancelada: no cuenta", p.blindLatePurchases(c6).length === 0);

  console.log(`\n${ok} bien, ${bad} con falla`);
  if (bad) process.exit(1);
}

void main();
