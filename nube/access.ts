/**
 * Quién puede leer y escribir cada tabla: las mismas reglas (RLS) que en
 * Supabase (pg_policies, 2026-11-21).
 *
 *  - service: el servidor de B-POS (llave secreta) → todo.
 *  - authenticated: una sesión de usuario → solo lo de sus negocios.
 *  - anon: sin sesión → casi nada (solo funciones RPC y el catálogo de servicios).
 *
 * `using` filtra las filas que se pueden ver, cambiar o borrar (SQL);
 * `check` revisa cada fila nueva o cambiada antes de guardarla.
 */
import type { Db, Row } from "./db";

export type Role = "anon" | "authenticated" | "service";
export type Auth = { role: Role; uid: string | null; email?: string | null };
export type Cmd = "select" | "insert" | "update" | "delete";

type Sql = { sql: string; params: unknown[] };
type Check = (row: Row, ctx: AccessCtx) => Promise<boolean>;
type Rule = { using?: (a: Auth) => Sql; check?: Check };

const MEMBER = (col = "business_id") => (a: Auth): Sql => ({ sql: `${col} IN (SELECT business_id FROM business_members WHERE user_id = ?)`, params: [a.uid] });
const ADMIN_SQL = "EXISTS (SELECT 1 FROM platform_admins WHERE user_id = ?)";
const MEMBER_OR_ADMIN = (a: Auth): Sql => ({ sql: `(business_id IN (SELECT business_id FROM business_members WHERE user_id = ?) OR ${ADMIN_SQL})`, params: [a.uid, a.uid] });
const ALL_ROWS = (): Sql => ({ sql: "1 = 1", params: [] });

/** Lo que hace falta saber para revisar una fila (se pregunta una vez por petición) */
export class AccessCtx {
  private members: Promise<Set<string>> | null = null;
  private branches = new Map<string, Promise<string | null>>();
  constructor(
    private db: Db,
    public auth: Auth
  ) {}
  memberships() {
    if (!this.members)
      this.members = this.auth.uid
        ? this.db.all<{ business_id: string }>("SELECT business_id FROM business_members WHERE user_id = ?", [this.auth.uid]).then((r) => new Set(r.map((x) => x.business_id)))
        : Promise.resolve(new Set());
    return this.members;
  }
  async isMember(businessId: unknown) {
    return typeof businessId === "string" && (await this.memberships()).has(businessId);
  }
  /** Negocio de una sucursal (branch_business) */
  branchBusiness(branchId: unknown) {
    const id = String(branchId ?? "");
    if (!this.branches.has(id)) this.branches.set(id, this.db.first<{ business_id: string }>("SELECT business_id FROM branches WHERE id = ?", [id]).then((r) => r?.business_id ?? null));
    return this.branches.get(id)!;
  }
  async isAdmin() {
    if (!this.auth.uid) return false;
    return Boolean(await this.db.first("SELECT 1 AS ok FROM platform_admins WHERE user_id = ?", [this.auth.uid]));
  }
}

const isMember: Check = (row, ctx) => ctx.isMember(row.business_id);
const memberAll = (): Partial<Record<Cmd, Rule>> => ({
  select: { using: MEMBER() },
  insert: { check: isMember },
  update: { using: MEMBER(), check: isMember },
  delete: { using: MEMBER() },
});

/** Reglas para sesiones de usuario (authenticated). Lo que no está aquí, no se puede. */
const AUTHENTICATED: Record<string, Partial<Record<Cmd, Rule>>> = {
  sync_records: (() => {
    // La fila es del negocio y su scope es "business" o una sucursal de ese negocio
    const check: Check = async (row, ctx) => (await ctx.isMember(row.business_id)) && (row.scope === "business" || (await ctx.branchBusiness(row.scope)) === row.business_id);
    return { select: { using: MEMBER() }, insert: { check }, update: { using: MEMBER(), check }, delete: { using: MEMBER() } };
  })(),
  bpos_bridge_orders: (() => {
    const check: Check = async (row, ctx) => (await ctx.isMember(row.business_id)) && (await ctx.branchBusiness(row.branch_id)) === row.business_id;
    return { select: { using: MEMBER() }, insert: { check }, update: { using: MEMBER(), check }, delete: { using: MEMBER() } };
  })(),
  bpos_bridge_aliases: memberAll(),
  bpos_backups: memberAll(),
  bpos_online_orders: memberAll(),
  bpos_reservations: memberAll(),
  bpos_reviews: memberAll(),
  push_subscriptions: memberAll(),
  branches: memberAll(),
  bpos_agents: { select: { using: MEMBER() }, update: { using: MEMBER(), check: isMember }, delete: { using: MEMBER() } },
  bpos_loyalty_members: { select: { using: MEMBER() } },
  bpos_loyalty_movements: { select: { using: MEMBER() } },
  bpos_menu_links: { select: { using: MEMBER() } },
  bpos_customer_accounts: { select: { using: MEMBER() } },
  bpos_waiter_devices: { select: { using: MEMBER() } },
  sync_heads: { select: { using: MEMBER() } },
  audit_events: { select: { using: MEMBER() }, insert: { check: isMember } },
  push_log: { select: { using: MEMBER() }, insert: { check: isMember } },
  bpos_agent_jobs: {
    select: { using: MEMBER() },
    insert: { check: async (row, ctx) => (await ctx.isMember(row.business_id)) && (await ctx.branchBusiness(row.branch_id)) === row.business_id && row.status === "pending" },
  },
  platform_admins: { select: { using: (a) => ({ sql: "user_id = ?", params: [a.uid] }) } },
  ai_usage: { select: { using: MEMBER_OR_ADMIN } },
  bpos_services: { select: { using: MEMBER_OR_ADMIN } },
  bpos_service_catalog: { select: { using: ALL_ROWS } },
  business_members: { select: { using: (a) => ({ sql: "(user_id = ? OR business_id IN (SELECT business_id FROM business_members WHERE user_id = ?))", params: [a.uid, a.uid] }) } },
  businesses: {
    select: { using: (a) => ({ sql: `(id IN (SELECT business_id FROM business_members WHERE user_id = ?) OR ${ADMIN_SQL})`, params: [a.uid, a.uid] }) },
    update: { using: (a) => ({ sql: "owner_id = ?", params: [a.uid] }), check: async (row, ctx) => row.owner_id === ctx.auth.uid },
  },
};

/** Sin sesión: solo el catálogo de servicios */
const ANON: Record<string, Partial<Record<Cmd, Rule>>> = {
  bpos_service_catalog: { select: { using: ALL_ROWS } },
};

export type Allowed = { ok: true; using: Sql | null; check: Check | null } | { ok: false };

/** ¿Puede hacer `cmd` en `table`? Con el filtro de filas y la revisión de filas nuevas */
export function allowed(table: string, cmd: Cmd, auth: Auth): Allowed {
  if (auth.role === "service") return { ok: true, using: null, check: null };
  const rules = (auth.role === "authenticated" && auth.uid ? AUTHENTICATED : ANON)[table];
  const rule = rules?.[cmd];
  if (!rule) return { ok: false };
  return { ok: true, using: rule.using ? rule.using(auth) : null, check: rule.check || null };
}
