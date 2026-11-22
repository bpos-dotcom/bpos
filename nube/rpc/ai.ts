/**
 * Presupuesto y créditos de IA (migraciones 0006 y 0029).
 */
import type { RpcFn } from "../rpc-types";
import { RpcError } from "../rpc-types";
import { isMember, isPlatformAdmin } from "./common";
import { nowIso } from "../values";

const monthStart = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
};
const budget = (plan: string, override: unknown) => (override === null || override === undefined ? (plan === "max" ? 5 : 0) : Number(override));
const day = (v: unknown) => String(v ?? "").slice(0, 10);

const allowance: RpcFn = async (ctx, args) => {
  const id = String(args.p_business_id ?? "");
  if (!((await isMember(ctx, id)) || (await isPlatformAdmin(ctx)))) throw new RpcError("SIN_ACCESO", 403, "42501");
  const b = await ctx.db.first<{ plan: string; plan_status: string; trial_ends_at: string; ai_budget_usd: number | null }>("SELECT plan, plan_status, trial_ends_at, ai_budget_usd FROM businesses WHERE id = ?", [id]);
  const spent = await ctx.db.first<{ cost_usd: number }>("SELECT cost_usd FROM ai_usage WHERE business_id = ? AND month = ?", [id, monthStart()]);
  const active = b ? b.plan_status === "active" || (b.plan_status === "trial" && Date.parse(b.trial_ends_at) > Date.now()) : false;
  return { plan: b?.plan ?? null, status: b?.plan_status ?? null, active, budget: b ? budget(b.plan, b.ai_budget_usd) : 0, spent: Number(spent?.cost_usd || 0) };
};

const charge: RpcFn = async (ctx, args) => {
  const id = String(args.p_business_id ?? "");
  if (!(await isMember(ctx, id))) throw new RpcError("SIN_ACCESO", 403, "42501");
  const cost = Number(args.p_cost);
  if (!Number.isFinite(cost) || cost < 0 || cost > 50) throw new RpcError("Costo inválido");
  const now = nowIso();
  await ctx.db.run(
    "INSERT INTO ai_usage (business_id, month, cost_usd, requests, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT (business_id, month) DO UPDATE SET cost_usd = cost_usd + excluded.cost_usd, requests = requests + 1, updated_at = excluded.updated_at",
    [id, monthStart(), cost, now]
  );
  return undefined;
};

/** Solo el servidor (en Supabase no era security definer: la sesión no podía) */
const serverOnly = (ctx: Parameters<RpcFn>[0]) => {
  if (ctx.auth.role !== "service") throw new RpcError("permission denied for table bpos_ai_credits", 403, "42501");
};

const creditsSpend: RpcFn = async (ctx, args) => {
  serverOnly(ctx);
  const cost = Math.trunc(Number(args.p_cost));
  const limit = Math.trunc(Number(args.p_limit));
  if (!Number.isFinite(cost) || cost <= 0 || !Number.isFinite(limit) || cost > limit) return -1;
  const r = await ctx.db.first<{ used: number }>(
    "INSERT INTO bpos_ai_credits (business_id, day, used, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (business_id, day) DO UPDATE SET used = used + excluded.used, updated_at = excluded.updated_at WHERE used + excluded.used <= ? RETURNING used",
    [String(args.p_business_id ?? ""), day(args.p_day), cost, nowIso(), limit]
  );
  return r ? Number(r.used) : -1;
};

const creditsRefund: RpcFn = async (ctx, args) => {
  serverOnly(ctx);
  await ctx.db.run("UPDATE bpos_ai_credits SET used = max(0, used - max(0, ?)), updated_at = ? WHERE business_id = ? AND day = ?", [Math.trunc(Number(args.p_cost) || 0), nowIso(), String(args.p_business_id ?? ""), day(args.p_day)]);
  return undefined;
};

export const AI_RPC: Record<string, RpcFn> = {
  bpos_ai_allowance: allowance,
  bpos_ai_charge: charge,
  bpos_ai_credits_spend: creditsSpend,
  bpos_ai_credits_refund: creditsRefund,
};
