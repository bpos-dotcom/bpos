/**
 * Dónde viven los pedidos y equivalencias del Bridge.
 *  - Nube (B-POS 2.0): tablas bpos_bridge_orders (por sucursal) y
 *    bpos_bridge_aliases (por negocio), con la sesión del usuario (RLS).
 *  - Disco: solo sin nube (pruebas locales), como en B-POS 1.x.
 */
import fs from "node:fs";
import path from "node:path";
import type { BridgeContext } from "@/lib/bridge/api-guard";
import { BRIDGE_DATA_DIR } from "@/lib/bridge/data-dir";
import { bridgeOrders, saveBridgeOrders } from "@/lib/bridge/orders-store";

/** DiDi reinicia sus números cada día: el mismo número de hace más de 12 h es otro pedido */
const SAME_ORDER_WINDOW_MS = 12 * 60 * 60 * 1000;

export type StoredBridgeOrder = {
  platform?: string;
  orderId?: string | null;
  status?: string;
  bridgeReceivedAt?: string;
  [key: string]: unknown;
};

export type StoredAlias = { id: string; [key: string]: unknown };

export type BridgeStore = {
  /** Pedidos, el más nuevo primero */
  orders(): Promise<StoredBridgeOrder[]>;
  /** Solo los que siguen en proceso (sin Finalizado ni Error): para las alertas de pendientes, sin bajar todo */
  activeOrders(): Promise<StoredBridgeOrder[]>;
  /** Un solo pedido (para cambiarlo sin bajar todos) */
  order(key: string): Promise<StoredBridgeOrder | null>;
  /**
   * Lo que el procesador en segundo plano tiene que revisar: los que siguen en
   * proceso y los finalizados de las últimas horas que aún no salieron a estaciones.
   */
  workOrders(sinceMs: number): Promise<StoredBridgeOrder[]>;
  /**
   * Aparta el pedido para un equipo (processingBy/processingAt) para que dos
   * pantallas no creen la misma venta ni impriman dos veces. true si quedó
   * apartado para este equipo (estaba libre, ya era suyo o el otro dejó de responder).
   */
  claimOrder(key: string, device: string, staleMs: number): Promise<boolean>;
  /** Huella de pedidos y equivalencias (cuántos y el último cambio): si no cambió, no hay que volver a bajarlos */
  version(): Promise<string>;
  /** false si ya existía (misma plataforma y número) */
  addOrder(order: StoredBridgeOrder): Promise<boolean>;
  saveOrder(order: StoredBridgeOrder): Promise<void>;
  clearOrders(): Promise<void>;
  /** Borra el historial de pedidos finalizados; así un ticket repetido ya no cuenta como duplicado */
  clearFinishedOrders(): Promise<number>;
  /** Quita un pedido que no tiene venta (prueba o ticket ilegible); false si no estaba o ya tiene venta */
  deletePendingOrder(order: { platform: string; orderId: string }): Promise<boolean>;
  aliases(): Promise<StoredAlias[]>;
  saveAlias(alias: StoredAlias): Promise<void>;
  deleteAlias(id: string): Promise<boolean>;
};

const KEEP_FINISHED_MS = 3 * 24 * 60 * 60 * 1000;

export function orderKey(order: { platform?: unknown; orderId?: unknown }) {
  return `${String(order.platform ?? "").trim().toLowerCase()}|${String(order.orderId ?? "").trim().toUpperCase()}`;
}

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

function cloudStore(ctx: Extract<BridgeContext, { mode: "cloud" }>): BridgeStore {
  const { db, businessId, branchId } = ctx;
  return {
    async orders() {
      // Los finalizados se conservan 3 días; los pendientes, siempre
      await db
        .from("bpos_bridge_orders")
        .delete()
        .eq("branch_id", branchId)
        .eq("status", "Finalizado")
        .lt("updated_at", new Date(Date.now() - KEEP_FINISHED_MS).toISOString());
      const { data, error } = await db
        .from("bpos_bridge_orders")
        .select("data")
        .eq("branch_id", branchId)
        .order("received_at", { ascending: false })
        .limit(300);
      fail(error);
      return (data ?? []).map((row) => row.data as StoredBridgeOrder);
    },
    async order(key) {
      const { data, error } = await db.from("bpos_bridge_orders").select("data").eq("branch_id", branchId).eq("order_key", key).maybeSingle();
      fail(error);
      return (data?.data as StoredBridgeOrder | undefined) ?? null;
    },
    async workOrders(sinceMs) {
      const since = new Date(Date.now() - sinceMs).toISOString();
      const [active, unprinted] = await Promise.all([
        db.from("bpos_bridge_orders").select("data").eq("branch_id", branchId).not("status", "in", "(Finalizado,Error)").order("received_at", { ascending: false }).limit(100),
        db.from("bpos_bridge_orders").select("data").eq("branch_id", branchId).eq("status", "Finalizado").gt("received_at", since).is("data->stationPrint", null).limit(50),
      ]);
      fail(active.error);
      fail(unprinted.error);
      return [...(active.data ?? []), ...(unprinted.data ?? [])].map((row) => row.data as StoredBridgeOrder);
    },
    async claimOrder(key, device, staleMs) {
      const cutoff = new Date(Date.now() - staleMs).toISOString();
      const { data: row, error } = await db.from("bpos_bridge_orders").select("data").eq("branch_id", branchId).eq("order_key", key).maybeSingle();
      fail(error);
      const current = row?.data as StoredBridgeOrder | undefined;
      if (!current) return false;
      const by = String(current.processingBy || "");
      if (by && by !== device && String(current.processingAt || "") > cutoff) return false;
      // La condición se vuelve a revisar al escribir: si otro equipo lo apartó en ese instante, no se pisa.
      // Sin tocar updated_at: apartar no cambia la huella (no hace que todos vuelvan a bajar los pedidos)
      const { data: claimed, error: claimError } = await db
        .from("bpos_bridge_orders")
        .update({ data: { ...current, processingBy: device, processingAt: new Date().toISOString() } })
        .eq("branch_id", branchId)
        .eq("order_key", key)
        .or(`data->>processingBy.is.null,data->>processingBy.eq."${device}",data->>processingAt.lt."${cutoff}"`)
        .select("order_key");
      fail(claimError);
      return (claimed ?? []).length > 0;
    },
    async version() {
      const [orders, aliases] = await Promise.all([
        db.from("bpos_bridge_orders").select("updated_at", { count: "exact" }).eq("branch_id", branchId).order("updated_at", { ascending: false }).limit(1),
        db.from("bpos_bridge_aliases").select("updated_at", { count: "exact" }).eq("business_id", businessId).order("updated_at", { ascending: false }).limit(1),
      ]);
      fail(orders.error);
      fail(aliases.error);
      return `${orders.count ?? 0}:${orders.data?.[0]?.updated_at ?? ""}|${aliases.count ?? 0}:${aliases.data?.[0]?.updated_at ?? ""}`;
    },
    async activeOrders() {
      const { data, error } = await db
        .from("bpos_bridge_orders")
        .select("data")
        .eq("branch_id", branchId)
        .not("status", "in", "(Finalizado,Error)")
        .order("received_at", { ascending: false })
        .limit(100);
      fail(error);
      return (data ?? []).map((row) => row.data as StoredBridgeOrder);
    },
    async addOrder(order) {
      // Mismo número de otro día (DiDi reinicia cada día) y ya terminado: se quita para que entre el nuevo
      await db
        .from("bpos_bridge_orders")
        .delete()
        .eq("branch_id", branchId)
        .eq("order_key", orderKey(order))
        .in("status", ["Finalizado", "Venta creada"])
        .lt("received_at", new Date(Date.now() - SAME_ORDER_WINDOW_MS).toISOString());
      const { data, error } = await db
        .from("bpos_bridge_orders")
        .upsert(
          { business_id: businessId, branch_id: branchId, order_key: orderKey(order), data: order, status: order.status || "Recibido" },
          { onConflict: "branch_id,order_key", ignoreDuplicates: true }
        )
        .select("order_key");
      fail(error);
      return (data ?? []).length > 0;
    },
    async saveOrder(order) {
      const { error } = await db
        .from("bpos_bridge_orders")
        .update({ data: order, status: order.status || "Recibido", updated_at: new Date().toISOString() })
        .eq("branch_id", branchId)
        .eq("order_key", orderKey(order));
      fail(error);
    },
    async clearOrders() {
      const { error } = await db.from("bpos_bridge_orders").delete().eq("branch_id", branchId);
      fail(error);
    },
    async clearFinishedOrders() {
      const { data, error } = await db
        .from("bpos_bridge_orders")
        .delete()
        .eq("branch_id", branchId)
        .in("status", ["Finalizado", "Venta creada"])
        .select("order_key");
      fail(error);
      return (data ?? []).length;
    },
    async deletePendingOrder(order) {
      const { data, error } = await db
        .from("bpos_bridge_orders")
        .delete()
        .eq("branch_id", branchId)
        .eq("order_key", orderKey(order))
        .not("status", "in", '("Finalizado","Venta creada")')
        .is("data->>createdOrderId", null)
        .select("order_key");
      fail(error);
      return (data ?? []).length > 0;
    },
    async aliases() {
      const { data, error } = await db
        .from("bpos_bridge_aliases")
        .select("data")
        .eq("business_id", businessId)
        .order("updated_at", { ascending: true });
      fail(error);
      return (data ?? []).map((row) => row.data as StoredAlias);
    },
    async saveAlias(alias) {
      const { error } = await db
        .from("bpos_bridge_aliases")
        .upsert({ business_id: businessId, id: alias.id, data: alias, updated_at: new Date().toISOString() }, { onConflict: "business_id,id" });
      fail(error);
    },
    async deleteAlias(id) {
      const { data, error } = await db.from("bpos_bridge_aliases").delete().eq("business_id", businessId).eq("id", id).select("id");
      fail(error);
      return (data ?? []).length > 0;
    },
  };
}

const ALIASES_FILE = path.join(BRIDGE_DATA_DIR, "bridge-aliases.json");

function readAliasFile(): StoredAlias[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(ALIASES_FILE, "utf8")) as { aliases?: StoredAlias[] };
    return Array.isArray(parsed.aliases) ? parsed.aliases : [];
  } catch {
    return [];
  }
}

function writeAliasFile(aliases: StoredAlias[]) {
  fs.mkdirSync(BRIDGE_DATA_DIR, { recursive: true });
  fs.writeFileSync(ALIASES_FILE, JSON.stringify({ aliases }, null, 2), "utf8");
}

const diskStore: BridgeStore = {
  async orders() {
    return bridgeOrders<StoredBridgeOrder>();
  },
  async activeOrders() {
    return bridgeOrders<StoredBridgeOrder>().filter((o) => o.status !== "Finalizado" && o.status !== "Error");
  },
  async order(key) {
    return bridgeOrders<StoredBridgeOrder>().find((o) => orderKey(o) === key) ?? null;
  },
  async workOrders(sinceMs) {
    return bridgeOrders<StoredBridgeOrder>().filter(
      (o) => (o.status !== "Finalizado" && o.status !== "Error") || (o.status === "Finalizado" && !o.stationPrint && Date.now() - (Date.parse(String(o.bridgeReceivedAt || "")) || 0) < sinceMs)
    );
  },
  async claimOrder(key, device, staleMs) {
    const order = bridgeOrders<StoredBridgeOrder>().find((o) => orderKey(o) === key);
    if (!order) return false;
    const by = String(order.processingBy || "");
    if (by && by !== device && Date.now() - (Date.parse(String(order.processingAt || "")) || 0) < staleMs) return false;
    order.processingBy = device;
    order.processingAt = new Date().toISOString();
    saveBridgeOrders();
    return true;
  },
  async version() {
    // Sin nube (pruebas en esta PC): leer el archivo es barato, siempre "cambió"
    return String(Date.now());
  },
  async addOrder(order) {
    const list = bridgeOrders<StoredBridgeOrder>();
    const stale = (o: StoredBridgeOrder) =>
      (o.status === "Finalizado" || o.status === "Venta creada") && Date.now() - (Date.parse(String(o.bridgeReceivedAt || "")) || 0) > SAME_ORDER_WINDOW_MS;
    for (let i = list.length - 1; i >= 0; i--) if (orderKey(list[i]) === orderKey(order) && stale(list[i])) list.splice(i, 1);
    if (list.some((o) => orderKey(o) === orderKey(order))) return false;
    list.unshift(order);
    saveBridgeOrders();
    return true;
  },
  async saveOrder(order) {
    const list = bridgeOrders<StoredBridgeOrder>();
    const index = list.findIndex((o) => orderKey(o) === orderKey(order));
    if (index >= 0) list[index] = order;
    saveBridgeOrders();
  },
  async clearOrders() {
    bridgeOrders().splice(0);
    saveBridgeOrders();
  },
  async clearFinishedOrders() {
    const list = bridgeOrders<StoredBridgeOrder>();
    const keep = list.filter((o) => o.status !== "Finalizado" && o.status !== "Venta creada");
    const removed = list.length - keep.length;
    list.splice(0, list.length, ...keep);
    saveBridgeOrders();
    return removed;
  },
  async deletePendingOrder(order) {
    const list = bridgeOrders<StoredBridgeOrder>();
    const index = list.findIndex(
      (o) => orderKey(o) === orderKey(order) && o.status !== "Finalizado" && o.status !== "Venta creada" && !o.createdOrderId
    );
    if (index < 0) return false;
    list.splice(index, 1);
    saveBridgeOrders();
    return true;
  },
  async aliases() {
    return readAliasFile();
  },
  async saveAlias(alias) {
    const list = readAliasFile();
    const index = list.findIndex((a) => a.id === alias.id);
    if (index >= 0) list[index] = alias;
    else list.push(alias);
    writeAliasFile(list);
  },
  async deleteAlias(id) {
    const list = readAliasFile();
    const next = list.filter((a) => a.id !== id);
    writeAliasFile(next);
    return next.length < list.length;
  },
};

export function bridgeStore(ctx: BridgeContext): BridgeStore {
  return ctx.mode === "cloud" ? cloudStore(ctx) : diskStore;
}
