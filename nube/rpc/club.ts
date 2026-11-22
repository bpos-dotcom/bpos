/**
 * Club de lealtad (migración 0016): buscar socio, sumar por compra y canjear.
 */
import type { Row } from "../db";
import type { RpcFn } from "../rpc-types";
import { RpcError } from "../rpc-types";
import { isMember } from "./common";
import { syncDoc } from "./menu";
import { nowIso } from "../values";

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const round2 = (x: number) => Math.round(x * 100) / 100;
type Member = { account_id: string; business_id: string; code: string; points: number; stamps: number; cashback: number };

const loyaltyFind: RpcFn = async (ctx, args) => {
  const q = String(args.p_query ?? "");
  const digits = q.replace(/\D/g, "");
  const code = q.trim().toUpperCase();
  const rows = await ctx.db.all<Row>(
    `SELECT a.id AS account_id, a.name, a.phone, a.business_id, m.code, m.account_id AS m_id, m.points, m.stamps, m.cashback
       FROM bpos_customer_accounts a LEFT JOIN bpos_loyalty_members m ON m.account_id = a.id
      WHERE a.email_verified_at IS NOT NULL AND ((? AND a.phone = ?) OR m.code = ?)
      ORDER BY a.name`,
    [digits.length >= 10 ? 1 : 0, digits.slice(-10), code]
  );
  const out = [];
  for (const r of rows) {
    if (!(await isMember(ctx, r.business_id))) continue;
    out.push({ account_id: r.account_id, name: r.name, phone: r.phone, code: r.code ?? null, member: r.m_id !== null && r.m_id !== undefined, points: n(r.points), stamps: n(r.stamps), cashback: n(r.cashback) });
  }
  return out;
};

const loyaltyEarn: RpcFn = async (ctx, args) => {
  const account = String(args.p_account ?? "");
  const m = await ctx.db.first<Member>("SELECT * FROM bpos_loyalty_members WHERE account_id = ?", [account]);
  if (!m) return { member: false };
  if (!(await isMember(ctx, m.business_id))) throw new RpcError("Sin permiso.");
  const cfg = (await syncDoc(ctx.db, m.business_id, "business", "bpos_loyalty")) || {};
  if (cfg.enabled !== true && cfg.enabled !== "true") return { member: true, enabled: false };
  const ref = String(args.p_ref ?? "");
  if (ref && (await ctx.db.first("SELECT 1 AS ok FROM bpos_loyalty_movements WHERE account_id = ? AND kind = 'compra' AND ref = ?", [account, ref]))) return { member: true, repeated: true };
  const amount = Math.max(0, n(args.p_amount));
  let points = 0;
  let stamps = 0;
  let cash = 0;
  if (cfg.kind === "sellos") {
    if (amount >= n(cfg.stampMinPurchase) && amount > 0) stamps = 1;
  } else if (cfg.kind === "cashback") cash = round2((amount * n(cfg.cashbackPercent)) / 100);
  else points = Math.floor(amount / Math.max(cfg.pesosPerPoint === undefined || cfg.pesosPerPoint === null ? 10 : n(cfg.pesosPerPoint), 1));
  const now = nowIso();
  const [, updated] = await ctx.db.batch([
    {
      sql: "INSERT INTO bpos_loyalty_movements (id, business_id, account_id, kind, points, stamps, cashback, amount, ref, note, created_by, created_at) VALUES (?, ?, ?, 'compra', ?, ?, ?, ?, ?, '', ?, ?)",
      params: [crypto.randomUUID(), m.business_id, account, points, stamps, cash, amount, ref, String(args.p_by ?? "").slice(0, 60), now],
    },
    { sql: "UPDATE bpos_loyalty_members SET points = points + ?, stamps = stamps + ?, cashback = cashback + ?, updated_at = ? WHERE account_id = ? RETURNING points, stamps, cashback", params: [points, stamps, cash, now, account] },
  ]);
  const u = (updated[0] || {}) as Row;
  return { member: true, points: n(u.points), stamps: n(u.stamps), cashback: n(u.cashback), earned: { points, stamps, cashback: cash } };
};

const loyaltyRedeem: RpcFn = async (ctx, args) => {
  const account = String(args.p_account ?? "");
  const m = await ctx.db.first<Member>("SELECT * FROM bpos_loyalty_members WHERE account_id = ?", [account]);
  if (!m || !(await isMember(ctx, m.business_id))) throw new RpcError("Socio no encontrado.");
  const p = Math.max(0, n(args.p_points));
  const s = Math.max(0, Math.trunc(n(args.p_stamps)));
  const c = round2(Math.max(0, n(args.p_cashback)));
  if (p > n(m.points) || s > n(m.stamps) || c > n(m.cashback)) throw new RpcError(`No le alcanza: tiene ${n(m.points)} puntos, ${n(m.stamps)} sellos y $${n(m.cashback)} de saldo.`);
  if (p === 0 && s === 0 && c === 0) throw new RpcError("Nada que canjear.");
  const now = nowIso();
  // La condición se repite al escribir: si otro equipo canjeó en ese instante, no queda en negativo
  const [, updated] = await ctx.db.batch([
    {
      sql: "INSERT INTO bpos_loyalty_movements (id, business_id, account_id, kind, points, stamps, cashback, amount, ref, note, created_by, created_at) SELECT ?, ?, ?, 'canje', ?, ?, ?, 0, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM bpos_loyalty_members WHERE account_id = ? AND points >= ? AND stamps >= ? AND cashback >= ?)",
      params: [crypto.randomUUID(), m.business_id, account, -p, -s, -c, String(args.p_ref ?? ""), String(args.p_note ?? "").slice(0, 120), String(args.p_by ?? "").slice(0, 60), now, account, p, s, c - 0.001],
    },
    {
      sql: "UPDATE bpos_loyalty_members SET points = points - ?, stamps = stamps - ?, cashback = round(cashback - ?, 2), updated_at = ? WHERE account_id = ? AND points >= ? AND stamps >= ? AND cashback >= ? RETURNING points, stamps, cashback",
      params: [p, s, c, now, account, p, s, c - 0.001],
    },
  ]);
  if (!updated.length) throw new RpcError("No le alcanza: alguien más acaba de canjear. Vuelve a buscar al socio.");
  const u = updated[0] as Row;
  return { points: n(u.points), stamps: n(u.stamps), cashback: n(u.cashback) };
};

export const CLUB_RPC: Record<string, RpcFn> = {
  bpos_loyalty_find: loyaltyFind,
  bpos_loyalty_earn: loyaltyEarn,
  bpos_loyalty_redeem: loyaltyRedeem,
};
