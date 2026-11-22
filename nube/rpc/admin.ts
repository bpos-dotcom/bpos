/**
 * Alta de negocio, panel del administrador de B-POS y la lista de tareas con
 * fotos (migraciones 0002, 0007 y 0041).
 */
import type { Row } from "../db";
import type { RpcFn } from "../rpc-types";
import { RpcError } from "../rpc-types";
import { isPlatformAdmin, requireUser } from "./common";
import { nowIso } from "../values";

const createBusiness: RpcFn = async (ctx, args) => {
  const uid = requireUser(ctx);
  const name = String(args.p_business_name ?? "").trim();
  if (!name) throw new RpcError("Falta el nombre del negocio.");
  const branchName = String(args.p_branch_name ?? "").trim() || "Matriz";
  const business = crypto.randomUUID();
  const branch = crypto.randomUUID();
  const now = nowIso();
  // Un negocio nuevo empieza en prueba de 14 días (businesses_new_trial)
  const trialEnds = new Date(Date.now() + 14 * 86400000).toISOString();
  await ctx.db.batch([
    { sql: "INSERT INTO businesses (id, name, owner_id, created_at, plan, plan_status, trial_ends_at, branches_paid) VALUES (?, ?, ?, ?, 'basic', 'trial', ?, 1)", params: [business, name, uid, now, trialEnds] },
    { sql: "INSERT INTO branches (id, business_id, name, created_at) VALUES (?, ?, ?, ?)", params: [branch, business, branchName, now] },
    { sql: "INSERT INTO business_members (business_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)", params: [business, uid, now] },
  ]);
  return { business_id: business, branch_id: branch };
};

const adminBusinesses: RpcFn = async (ctx) => {
  if (!(await isPlatformAdmin(ctx))) throw new RpcError("Solo el administrador de B-POS");
  const month = `${new Date().toISOString().slice(0, 7)}-01`;
  const rows = await ctx.db.all<Row>(
    `SELECT b.id, b.name, b.created_at, b.plan, b.plan_status, b.trial_ends_at, b.paid_until, b.branches_paid,
            (SELECT COUNT(*) FROM branches br WHERE br.business_id = b.id) AS branches,
            b.ai_budget_usd, COALESCE(u.cost_usd, 0) AS ai_spent_usd, COALESCE(u.requests, 0) AS ai_requests,
            b.mp_preapproval_id, b.mp_payer_email,
            COALESCE((SELECT email FROM nube_users WHERE id = b.owner_id),
                     (SELECT nu.email FROM business_members m JOIN nube_users nu ON nu.id = m.user_id WHERE m.business_id = b.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1)) AS owner_email
       FROM businesses b LEFT JOIN ai_usage u ON u.business_id = b.id AND u.month = ?
      ORDER BY b.created_at DESC`,
    [month]
  );
  return rows.map((r) => ({ ...r, branches_paid: Number(r.branches_paid), branches: Number(r.branches), ai_budget_usd: r.ai_budget_usd === null ? null : Number(r.ai_budget_usd), ai_spent_usd: Number(r.ai_spent_usd), ai_requests: Number(r.ai_requests) }));
};

const adminUpdateBusiness: RpcFn = async (ctx, args) => {
  if (!(await isPlatformAdmin(ctx))) throw new RpcError("Solo el administrador de B-POS");
  const plan = String(args.p_plan ?? "");
  const status = String(args.p_status ?? "");
  if (!["basic", "pro", "max"].includes(plan)) throw new RpcError("Plan inválido");
  if (!["trial", "active", "past_due", "cancelled"].includes(status)) throw new RpcError("Estado inválido");
  const ts = (v: unknown) => (v === null || v === undefined || v === "" ? null : new Date(String(v)).toISOString());
  await ctx.db.run(
    "UPDATE businesses SET plan = ?, plan_status = ?, trial_ends_at = COALESCE(?, trial_ends_at), paid_until = ?, branches_paid = max(1, COALESCE(?, 1)), ai_budget_usd = ?, plan_updated_at = ? WHERE id = ?",
    [plan, status, ts(args.p_trial_ends_at), ts(args.p_paid_until), args.p_branches_paid === null || args.p_branches_paid === undefined ? null : Math.trunc(Number(args.p_branches_paid)), args.p_ai_budget_usd === null || args.p_ai_budget_usd === undefined ? null : Number(args.p_ai_budget_usd), nowIso(), String(args.p_business_id ?? "")]
  );
  return undefined;
};

const taskEvidenceItem: RpcFn = async ({ db }, args) => {
  const token = String(args.p_token ?? "");
  const index = Math.trunc(Number(args.p_index));
  const row = await db.first<{ items: string | null }>("SELECT items FROM bpos_task_evidence WHERE token = ?", [token]);
  if (!row?.items) return null;
  let items: unknown;
  try {
    items = JSON.parse(row.items);
  } catch {
    return null;
  }
  if (!Array.isArray(items) || index < 0 || index >= items.length) return null;
  const patch = args.p_patch && typeof args.p_patch === "object" ? (args.p_patch as Row) : {};
  const current = items[index] && typeof items[index] === "object" && !Array.isArray(items[index]) ? (items[index] as Row) : {};
  items[index] = { ...current, ...patch };
  await db.run("UPDATE bpos_task_evidence SET items = ? WHERE token = ?", [JSON.stringify(items), token]);
  return items;
};

export const ADMIN_RPC: Record<string, RpcFn> = {
  create_business: createBusiness,
  bpos_admin_businesses: adminBusinesses,
  bpos_admin_update_business: adminUpdateBusiness,
  bpos_task_evidence_item: taskEvidenceItem,
};
