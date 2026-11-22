/**
 * B-POS Agent (la computadora que imprime y lee los tickets de las apps):
 * vincular con código, revisar su cola de trabajos, terminar trabajos y
 * mandar pedidos de Uber/DiDi/Rappi. Migraciones 0008, 0022, 0027 y 0045.
 */
import type { Db, Row } from "../db";
import type { RpcFn } from "../rpc-types";
import { RpcError } from "../rpc-types";
import { isMember, branchBusiness, randomFrom, randomHex, sha256Hex } from "./common";
import { syncDoc } from "./menu";
import { nowIso } from "../values";
import { isSameOrder, repeatKey } from "../../lib/bridge/order-identity";

type Agent = { id: string; business_id: string; branch_id: string; name: string; version: string; printers: string; last_seen_at: string | null; kiosk_id: string | null };

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const parse = (s: unknown) => {
  if (typeof s !== "string") return (s ?? null) as unknown;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

export async function agentByToken(db: Db, token: unknown): Promise<Agent> {
  const hash = await sha256Hex(String(token ?? ""));
  const agent = await db.first<Agent>("SELECT * FROM bpos_agents WHERE token_hash = ? AND revoked_at IS NULL", [hash]);
  if (!agent) throw new RpcError("Agent desvinculado", 401, "28000");
  return agent;
}

const newCode: RpcFn = async (ctx, args) => {
  const branchId = String(args.p_branch_id ?? "");
  const business = await branchBusiness(ctx.db, branchId);
  if (!business || !(await isMember(ctx, business))) throw new RpcError("Sucursal no encontrada");
  await ctx.db.run("DELETE FROM bpos_agent_codes WHERE expires_at < ?", [ago(86400000)]);
  let code = "";
  for (let i = 0; i < 20; i++) {
    code = randomFrom(CODE_ALPHABET, 8);
    if (!(await ctx.db.first("SELECT 1 AS ok FROM bpos_agent_codes WHERE code = ?", [code]))) break;
  }
  const expires = new Date(Date.now() + 15 * 60000).toISOString();
  await ctx.db.run("INSERT INTO bpos_agent_codes (code, business_id, branch_id, created_by, expires_at) VALUES (?, ?, ?, ?, ?)", [code, business, branchId, ctx.auth.uid, expires]);
  return { code, expires_at: expires };
};

const pair: RpcFn = async ({ db }, args) => {
  const code = String(args.p_code ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const now = nowIso();
  // Se marca usado en la misma escritura: dos Agents con el mismo código, solo uno entra
  const c = await db.first<{ code: string; business_id: string; branch_id: string; kiosk_id: string | null }>(
    "UPDATE bpos_agent_codes SET used_at = ? WHERE code = ? AND used_at IS NULL AND expires_at >= ? RETURNING code, business_id, branch_id, kiosk_id",
    [now, code, now]
  );
  if (!c) throw new RpcError("Código inválido o vencido");
  const token = randomHex(32);
  const id = crypto.randomUUID();
  const statements = [];
  // Una pantalla de kiosco tiene un solo Agent: el anterior queda desvinculado
  if (c.kiosk_id) statements.push({ sql: "UPDATE bpos_agents SET revoked_at = ? WHERE kiosk_id = ? AND revoked_at IS NULL", params: [now, c.kiosk_id] });
  statements.push({
    sql: "INSERT INTO bpos_agents (id, business_id, branch_id, name, token_hash, version, printers, last_seen_at, created_at, kiosk_id) VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)",
    params: [id, c.business_id, c.branch_id, String(args.p_name ?? "").slice(0, 80), await sha256Hex(token), String(args.p_version ?? "").slice(0, 30), now, now, c.kiosk_id],
  });
  await db.batch(statements);
  const business = await db.first<{ name: string }>("SELECT name FROM businesses WHERE id = ?", [c.business_id]);
  const branch = await db.first<{ name: string }>("SELECT name FROM branches WHERE id = ?", [c.branch_id]);
  return { token, agent_id: id, business_name: business?.name ?? null, branch_name: branch?.name ?? null };
};

const poll: RpcFn = async ({ db }, args) => {
  const agent = await agentByToken(db, args.p_token);
  const now = nowIso();
  const version = args.p_version === null || args.p_version === undefined ? null : String(args.p_version).slice(0, 30);
  const printers = args.p_printers === null || args.p_printers === undefined ? null : args.p_printers;
  // "Sigo vivo" cada 15 s como máximo; la versión o las impresoras en cuanto cambian
  const statements = [];
  if (printers !== null || !agent.last_seen_at || Date.parse(agent.last_seen_at) < Date.now() - 15000 || (version !== null && agent.version !== version)) {
    statements.push({
      sql: "UPDATE bpos_agents SET last_seen_at = ?, version = COALESCE(?, version), printers = COALESCE(?, printers) WHERE id = ?",
      params: [now, version, printers === null ? null : JSON.stringify(printers), agent.id],
    });
  }
  // Lo viejo ya no se imprime (ej. el Agent estuvo apagado una hora)
  statements.push({
    sql: "UPDATE bpos_agent_jobs SET status = 'error', result = '{\"error\":\"El Agent no lo recibió a tiempo.\"}', done_at = ? WHERE branch_id = ? AND status = 'pending' AND created_at < ?",
    params: [now, agent.branch_id, ago(10 * 60000)],
  });
  if (Math.random() < 0.01) statements.push({ sql: "DELETE FROM bpos_agent_jobs WHERE branch_id = ? AND created_at < ?", params: [agent.branch_id, ago(3 * 86400000)] });
  // Tomar hasta 10 trabajos (UPDATE con RETURNING: un trabajo lo toma un solo Agent)
  const target = agent.kiosk_id ? "target_agent = ?" : "target_agent IS NULL";
  statements.push({
    sql: `UPDATE bpos_agent_jobs SET status = 'taken', agent_id = ?, taken_at = ?
           WHERE id IN (SELECT id FROM bpos_agent_jobs WHERE branch_id = ? AND status = 'pending' AND ${target} ORDER BY created_at LIMIT 10)
           RETURNING id, kind, payload, created_at`,
    params: agent.kiosk_id ? [agent.id, now, agent.branch_id, agent.id] : [agent.id, now, agent.branch_id],
  });
  const results = await db.batch(statements);
  const taken = (results[results.length - 1] || []) as Row[];
  const jobs = taken
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((j) => ({ id: Number(j.id), kind: j.kind, payload: parse(j.payload) }));

  let config: unknown = null;
  if (agent.kiosk_id) {
    const kiosk = await db.first<{ printer: string; paper_mm: number }>("SELECT printer, paper_mm FROM bpos_kiosks WHERE id = ? AND revoked_at IS NULL", [agent.kiosk_id]);
    // La impresora de la pantalla es su "Caja" (ahí sale el ticket del cliente)
    config = { Caja: kiosk?.printer ?? "", paperWidthMm: Number(kiosk?.paper_mm ?? 80), printMode: "escpos" };
  } else {
    config = await syncDoc(db, agent.business_id, agent.branch_id, "bpos_station_printers");
  }
  const business = await db.first<{ name: string }>("SELECT name FROM businesses WHERE id = ?", [agent.business_id]);
  const branch = await db.first<{ name: string }>("SELECT name FROM branches WHERE id = ?", [agent.branch_id]);
  return { business_name: business?.name ?? null, branch_name: branch?.name ?? null, station_printers: config, jobs };
};

const finish: RpcFn = async ({ db }, args) => {
  const agent = await agentByToken(db, args.p_token);
  await db.run("UPDATE bpos_agent_jobs SET status = ?, result = ?, done_at = ? WHERE id = ? AND branch_id = ?", [
    args.p_ok === true ? "done" : "error",
    args.p_result === undefined ? null : JSON.stringify(args.p_result),
    nowIso(),
    Number(args.p_job_id),
    agent.branch_id,
  ]);
  return undefined;
};

const importData: RpcFn = async ({ db }, args) => {
  const agent = await agentByToken(db, args.p_token);
  const aliases = (Array.isArray(args.p_aliases) ? args.p_aliases : []).filter((a: Row) => a && String(a.id ?? "") !== "");
  const orders = (Array.isArray(args.p_orders) ? args.p_orders : []).filter((o: Row) => o && String(o.platform ?? "").trim() !== "" && String(o.orderId ?? "").trim() !== "");
  const now = nowIso();
  const res = await db.batch([
    ...aliases.map((a: Row) => ({ sql: "INSERT INTO bpos_bridge_aliases (business_id, id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (business_id, id) DO NOTHING RETURNING id", params: [agent.business_id, String(a.id), JSON.stringify(a), now] })),
    ...orders.map((o: Row) => ({
      sql: "INSERT INTO bpos_bridge_orders (business_id, branch_id, order_key, data, status, received_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (branch_id, order_key) DO NOTHING RETURNING order_key",
      params: [agent.business_id, agent.branch_id, `${String(o.platform).trim().toLowerCase()}|${String(o.orderId).trim().toUpperCase()}`, JSON.stringify(o), String(o.status ?? "Recibido"), now, now],
    })),
  ]);
  return { aliases: res.slice(0, aliases.length).filter((r) => r.length).length, orders: res.slice(aliases.length).filter((r) => r.length).length };
};

const submitOrder: RpcFn = async ({ db }, args) => {
  const agent = await agentByToken(db, args.p_token);
  const order = (args.p_order || {}) as Row;
  const platform = String(order.platform ?? "").trim().toLowerCase();
  const orderId = String(order.orderId ?? "").trim().toUpperCase();
  if (!platform || !orderId) throw new RpcError("Faltan platform u orderId");
  const base = `${platform}|${orderId}`;
  const prev = await db.first<{ data: string; received_at: string }>(
    "SELECT data, received_at FROM bpos_bridge_orders WHERE branch_id = ? AND (order_key = ? OR substr(order_key, 1, ?) = ?) ORDER BY received_at DESC LIMIT 1",
    [agent.branch_id, base, base.length + 1, `${base}|`]
  );
  const nowMs = Date.now();
  let key = base;
  if (prev) {
    const prevData = (parse(prev.data) || {}) as Row;
    // La misma regla que la caja (lib/bridge/order-identity.ts): DiDi reinicia sus números a las 00:00
    const same = isSameOrder({ platform, at: Date.parse(prev.received_at), total: prevData.total, items: prevData.items }, { platform, at: nowMs, total: order.total, items: order.items });
    if (same) return { duplicate: true };
    key = repeatKey(base, nowMs);
  }
  const now = new Date(nowMs).toISOString();
  const data = { ...order, id: order.id ?? nowMs, platform, orderId, bridgeReceivedAt: now, status: "Recibido", ...(key === base ? {} : { bridgeKey: key }) };
  const r = await db.first(
    "INSERT INTO bpos_bridge_orders (business_id, branch_id, order_key, data, status, received_at, updated_at) VALUES (?, ?, ?, ?, 'Recibido', ?, ?) ON CONFLICT (branch_id, order_key) DO NOTHING RETURNING order_key",
    [agent.business_id, agent.branch_id, key, JSON.stringify(data), now, now]
  );
  return { duplicate: !r };
};

export const AGENT_RPC: Record<string, RpcFn> = {
  bpos_agent_new_code: newCode,
  bpos_agent_pair: pair,
  bpos_agent_poll: poll,
  bpos_agent_finish: finish,
  bpos_agent_import: importData,
  bpos_agent_submit_order: submitOrder,
};
