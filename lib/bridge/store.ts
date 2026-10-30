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
  /** false si ya existía (misma plataforma y número) */
  addOrder(order: StoredBridgeOrder): Promise<boolean>;
  saveOrder(order: StoredBridgeOrder): Promise<void>;
  clearOrders(): Promise<void>;
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
    async addOrder(order) {
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
  async addOrder(order) {
    const list = bridgeOrders<StoredBridgeOrder>();
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
