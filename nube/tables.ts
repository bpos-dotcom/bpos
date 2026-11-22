/**
 * Las tablas de B-POS en la nube de Cloudflare (D1), copiadas de Supabase
 * (information_schema, 2026-11-21). De aquí sale el esquema de D1
 * (`schemaSql`) y el REST compatible sabe cómo guardar y devolver cada
 * columna (uuid y fechas como texto, jsonb como texto JSON, bool como 0/1).
 *
 * Solo las tablas que B-POS usa hoy. Las viejas del esquema 0001 (orders,
 * products, ingredients…) están vacías y ya no se usan: no se mudan.
 */

export type ColType = "uuid" | "text" | "int" | "num" | "bool" | "json" | "ts" | "date";

export type Default =
  | { kind: "uuid" }
  | { kind: "now" }
  | { kind: "uid" } // auth.uid() de quien escribe
  | { kind: "value"; value: unknown }
  | { kind: "nowPlusDays"; days: number }
  | { kind: "identity" } // int8 generado (INTEGER PRIMARY KEY)
  | { kind: "seq"; name: string }; // número que nunca se repite (sync_seq)

export type Column = { name: string; type: ColType; nullable: boolean; default?: Default };

export type Table = {
  name: string;
  columns: Column[];
  pk: string[];
  /** Llaves únicas además de la primaria (para on_conflict) */
  unique: string[][];
  /** Índices extra (SQL después de "ON tabla") */
  indexes: string[];
  /** Validaciones (CHECK) en SQL de SQLite */
  checks: string[];
};

// ------------------------------------------------------------ ayudantes para escribir las tablas cortito
const c = (name: string, type: ColType, opts: { null?: boolean; def?: Default } = {}): Column => ({ name, type, nullable: Boolean(opts.null), ...(opts.def ? { default: opts.def } : {}) });
const NOW: Default = { kind: "now" };
const UUID: Default = { kind: "uuid" };
const v = (value: unknown): Default => ({ kind: "value", value });
const t = (name: string, columns: Column[], pk: string[], more: Partial<Pick<Table, "unique" | "indexes" | "checks">> = {}): Table => ({
  name,
  columns,
  pk,
  unique: more.unique || [],
  indexes: more.indexes || [],
  checks: more.checks || [],
});
const oneOf = (col: string, values: string[]) => `${col} IN (${values.map((x) => `'${x}'`).join(", ")})`;

export const TABLES: Table[] = [
  t("ai_usage", [c("business_id", "uuid"), c("month", "date"), c("cost_usd", "num", { def: v(0) }), c("requests", "int", { def: v(0) }), c("updated_at", "ts", { def: NOW })], ["business_id", "month"]),
  t(
    "audit_events",
    [
      c("id", "int", { def: { kind: "identity" } }),
      c("business_id", "uuid"),
      c("branch_id", "uuid", { null: true }),
      c("event_id", "text"),
      c("category", "text"),
      c("action", "text"),
      c("description", "text", { def: v("") }),
      c("user_name", "text", { null: true }),
      c("user_id", "text", { null: true }),
      c("entity_id", "text", { null: true }),
      c("device_id", "text", { null: true }),
      c("metadata", "json", { null: true }),
      c("happened_at", "ts"),
      c("received_at", "ts", { def: NOW }),
    ],
    ["id"],
    { unique: [["business_id", "event_id"]], indexes: ["(business_id, happened_at DESC)"] }
  ),
  t(
    "bpos_advisor_weekly",
    [
      c("business_id", "uuid"),
      c("enabled", "bool", { def: v(false) }),
      c("email", "text", { def: v("") }),
      c("metrics", "json", { null: true }),
      c("metrics_at", "ts", { null: true }),
      c("last_week", "text", { def: v("") }),
      c("last_error", "text", { def: v("") }),
      c("updated_at", "ts", { def: NOW }),
      c("last_analysis_at", "ts", { null: true }),
    ],
    ["business_id"]
  ),
  t(
    "bpos_agent_codes",
    [c("code", "text"), c("business_id", "uuid"), c("branch_id", "uuid"), c("created_by", "uuid", { null: true }), c("expires_at", "ts"), c("used_at", "ts", { null: true }), c("kiosk_id", "uuid", { null: true })],
    ["code"]
  ),
  t(
    "bpos_agent_jobs",
    [
      c("id", "int", { def: { kind: "identity" } }),
      c("business_id", "uuid"),
      c("branch_id", "uuid"),
      c("kind", "text"),
      c("payload", "json", { def: v({}) }),
      c("status", "text", { def: v("pending") }),
      c("result", "json", { null: true }),
      c("agent_id", "uuid", { null: true }),
      c("created_by", "uuid", { null: true, def: { kind: "uid" } }),
      c("created_at", "ts", { def: NOW }),
      c("taken_at", "ts", { null: true }),
      c("done_at", "ts", { null: true }),
      c("target_agent", "uuid", { null: true }),
    ],
    ["id"],
    {
      indexes: ["(branch_id, status, created_at)"],
      checks: [oneOf("status", ["pending", "taken", "done", "error"]), oneOf("kind", ["print-tickets", "print-original", "station-printers", "print", "open-drawer"])],
    }
  ),
  t(
    "bpos_agents",
    [
      c("id", "uuid", { def: UUID }),
      c("business_id", "uuid"),
      c("branch_id", "uuid"),
      c("name", "text", { def: v("") }),
      c("token_hash", "text"),
      c("version", "text", { def: v("") }),
      c("printers", "json", { def: v([]) }),
      c("last_seen_at", "ts", { null: true }),
      c("created_at", "ts", { def: NOW }),
      c("revoked_at", "ts", { null: true }),
      c("kiosk_id", "uuid", { null: true }),
    ],
    ["id"],
    { unique: [["token_hash"]], indexes: ["(branch_id)"] }
  ),
  t("bpos_ai_credits", [c("business_id", "uuid"), c("day", "date"), c("used", "int", { def: v(0) }), c("updated_at", "ts", { def: NOW })], ["business_id", "day"], { checks: ["used >= 0"] }),
  t(
    "bpos_ai_image_settings",
    [
      c("feature", "text", { def: v("fotos") }),
      c("provider", "text", { def: v("openai") }),
      c("model", "text", { def: v("gpt-image-1") }),
      c("key_cipher", "text", { def: v("") }),
      c("key_hint", "text", { def: v("") }),
      c("price_in", "num", { def: v(0) }),
      c("price_out", "num", { def: v(0) }),
      c("credits_per_day", "int", { def: v(25) }),
      c("credits_per_use", "int", { def: v(5) }),
      c("updated_by", "text", { def: v("") }),
      c("updated_at", "ts", { def: NOW }),
      c("prompt_keep", "text", { def: v("") }),
      c("prompt_remove", "text", { def: v("") }),
      c("credits_period", "text", { def: v("dia") }),
    ],
    ["feature"],
    { checks: ["feature = 'fotos'", oneOf("provider", ["openai", "gemini"]), "credits_per_day >= 0", "credits_per_use > 0", oneOf("credits_period", ["dia", "semana", "mes"])] }
  ),
  t(
    "bpos_ai_settings",
    [
      c("feature", "text"),
      c("provider", "text"),
      c("model", "text"),
      c("key_cipher", "text", { def: v("") }),
      c("key_hint", "text", { def: v("") }),
      c("price_in", "num", { def: v(0) }),
      c("price_out", "num", { def: v(0) }),
      c("updated_by", "text", { def: v("") }),
      c("updated_at", "ts", { def: NOW }),
      c("refresh_days", "int", { def: v(1) }),
    ],
    ["feature"],
    { checks: [oneOf("feature", ["interprete", "asesor"]), oneOf("provider", ["anthropic", "gemini"]), "refresh_days IN (0, 1, 3, 7)"] }
  ),
  t("bpos_backups", [c("business_id", "uuid"), c("day", "date"), c("data", "json"), c("size", "int", { def: v(0) }), c("created_at", "ts", { def: NOW })], ["business_id", "day"]),
  t("bpos_bridge_aliases", [c("business_id", "uuid"), c("id", "text"), c("data", "json"), c("updated_at", "ts", { def: NOW })], ["business_id", "id"]),
  t(
    "bpos_bridge_orders",
    [c("business_id", "uuid"), c("branch_id", "uuid"), c("order_key", "text"), c("data", "json"), c("status", "text", { def: v("Recibido") }), c("received_at", "ts", { def: NOW }), c("updated_at", "ts", { def: NOW })],
    ["branch_id", "order_key"],
    { indexes: ["(branch_id, received_at DESC)"] }
  ),
  t(
    "bpos_customer_accounts",
    [
      c("id", "uuid", { def: UUID }),
      c("business_id", "uuid"),
      c("phone", "text"),
      c("name", "text", { def: v("") }),
      c("email", "text", { def: v("") }),
      c("password_hash", "text", { def: v("") }),
      c("email_verified_at", "ts", { null: true }),
      c("address", "json", { def: v({}) }),
      c("failed_logins", "int", { def: v(0) }),
      c("locked_until", "ts", { null: true }),
      c("created_at", "ts", { def: NOW }),
      c("updated_at", "ts", { def: NOW }),
    ],
    ["id"],
    { unique: [["business_id", "phone"]], checks: ["length(phone) = 10 AND phone NOT GLOB '*[^0-9]*'"] }
  ),
  t(
    "bpos_customer_codes",
    [c("id", "uuid", { def: UUID }), c("account_id", "uuid"), c("purpose", "text"), c("code_hash", "text"), c("attempts", "int", { def: v(0) }), c("expires_at", "ts"), c("used_at", "ts", { null: true }), c("created_at", "ts", { def: NOW })],
    ["id"],
    { indexes: ["(account_id, created_at DESC)"], checks: [oneOf("purpose", ["verificar", "contrasena"])] }
  ),
  t(
    "bpos_customer_sessions",
    [c("token_hash", "text"), c("account_id", "uuid"), c("created_at", "ts", { def: NOW }), c("last_seen_at", "ts", { def: NOW }), c("expires_at", "ts")],
    ["token_hash"],
    { indexes: ["(account_id)"] }
  ),
  t("bpos_kiosk_codes", [c("code", "text"), c("business_id", "uuid"), c("branch_id", "uuid"), c("created_by", "uuid", { null: true }), c("expires_at", "ts"), c("used_at", "ts", { null: true })], ["code"]),
  t(
    "bpos_kiosks",
    [
      c("id", "uuid", { def: UUID }),
      c("business_id", "uuid"),
      c("branch_id", "uuid"),
      c("name", "text", { def: v("") }),
      c("token_hash", "text"),
      c("terminal_id", "text", { def: v("") }),
      c("last_seen_at", "ts", { null: true }),
      c("created_at", "ts", { def: NOW }),
      c("revoked_at", "ts", { null: true }),
      c("printer", "text", { def: v("") }),
      c("paper_mm", "int", { def: v(80) }),
    ],
    ["id"],
    { unique: [["token_hash"]], indexes: ["(branch_id)"] }
  ),
  t("bpos_license_keys", [c("id", "int", { def: v(1) }), c("public_key", "text"), c("private_key", "text"), c("created_at", "ts", { def: NOW })], ["id"], { checks: ["id = 1"] }),
  t(
    "bpos_loyalty_members",
    [
      c("account_id", "uuid"),
      c("business_id", "uuid"),
      c("code", "text"),
      c("points", "num", { def: v(0) }),
      c("stamps", "int", { def: v(0) }),
      c("cashback", "num", { def: v(0) }),
      c("wallet_saved", "bool", { def: v(false) }),
      c("joined_at", "ts", { def: NOW }),
      c("updated_at", "ts", { def: NOW }),
    ],
    ["account_id"],
    { unique: [["business_id", "code"]] }
  ),
  t(
    "bpos_loyalty_movements",
    [
      c("id", "uuid", { def: UUID }),
      c("business_id", "uuid"),
      c("account_id", "uuid"),
      c("kind", "text"),
      c("points", "num", { def: v(0) }),
      c("stamps", "int", { def: v(0) }),
      c("cashback", "num", { def: v(0) }),
      c("amount", "num", { def: v(0) }),
      c("ref", "text", { def: v("") }),
      c("note", "text", { def: v("") }),
      c("created_by", "text", { def: v("") }),
      c("created_at", "ts", { def: NOW }),
    ],
    ["id"],
    { indexes: ["(account_id, created_at DESC)", "UNIQUE (account_id, kind, ref) WHERE ref <> ''"], checks: [oneOf("kind", ["bienvenida", "compra", "canje", "ajuste"])] }
  ),
  t(
    "bpos_menu_links",
    [c("slug", "text"), c("business_id", "uuid"), c("branch_id", "uuid"), c("created_at", "ts", { def: NOW })],
    ["slug"],
    { unique: [["branch_id"]], checks: ["length(slug) BETWEEN 3 AND 40 AND slug NOT GLOB '*[^a-z0-9-]*' AND slug NOT GLOB '-*' AND slug NOT GLOB '*-'"] }
  ),
  t(
    "bpos_mp_accounts",
    [
      c("business_id", "uuid"),
      c("mp_user_id", "text"),
      c("nickname", "text", { def: v("") }),
      c("access_token", "text"),
      c("refresh_token", "text", { def: v("") }),
      c("expires_at", "ts", { null: true }),
      c("live_mode", "bool", { def: v(true) }),
      c("linked_by", "uuid", { null: true }),
      c("linked_at", "ts", { def: NOW }),
      c("updated_at", "ts", { def: NOW }),
    ],
    ["business_id"]
  ),
  t(
    "bpos_mp_charges",
    [c("id", "text"), c("business_id", "uuid"), c("branch_id", "uuid"), c("amount", "num"), c("reference", "text"), c("status", "text", { def: v("created") }), c("created_at", "ts", { def: NOW }), c("updated_at", "ts", { def: NOW })],
    ["id"],
    { indexes: ["(branch_id, created_at DESC)"] }
  ),
  t("bpos_mp_link_states", [c("state", "text"), c("business_id", "uuid"), c("user_id", "uuid"), c("created_at", "ts", { def: NOW })], ["state"]),
  t("bpos_mp_terminals", [c("branch_id", "uuid"), c("business_id", "uuid"), c("terminal_id", "text"), c("updated_at", "ts", { def: NOW })], ["branch_id"]),
  t(
    "bpos_online_orders",
    [
      c("id", "uuid", { def: UUID }),
      c("business_id", "uuid"),
      c("branch_id", "uuid"),
      c("folio", "text"),
      c("token", "text"),
      c("status", "text", { def: v("nuevo") }),
      c("data", "json"),
      c("sale_order_id", "int", { null: true }),
      c("eta_minutes", "int", { null: true }),
      c("reason", "text", { null: true }),
      c("created_at", "ts", { def: NOW }),
      c("updated_at", "ts", { def: NOW }),
      c("account_id", "uuid", { null: true }),
    ],
    ["id"],
    {
      indexes: ["(branch_id, created_at DESC)", "(branch_id) WHERE status IN ('nuevo', 'aceptando')", "(account_id, created_at DESC) WHERE account_id IS NOT NULL"],
      checks: [oneOf("status", ["nuevo", "aceptando", "aceptado", "rechazado", "listo", "entregado"])],
    }
  ),
  t(
    "bpos_reservations",
    [
      c("id", "uuid", { def: UUID }),
      c("business_id", "uuid"),
      c("branch_id", "uuid"),
      c("token", "text"),
      c("customer_name", "text"),
      c("customer_phone", "text", { def: v("") }),
      c("people", "int"),
      c("reserved_at", "ts"),
      c("note", "text", { def: v("") }),
      c("status", "text", { def: v("nueva") }),
      c("reason", "text", { def: v("") }),
      c("attended_by", "text", { def: v("") }),
      c("created_at", "ts", { def: NOW }),
      c("updated_at", "ts", { def: NOW }),
    ],
    ["id"],
    { indexes: ["(branch_id, reserved_at DESC)"], checks: ["people BETWEEN 1 AND 100", oneOf("status", ["nueva", "confirmada", "rechazada", "cancelada", "llego", "no_llego"])] }
  ),
  t(
    "bpos_reviews",
    [
      c("id", "uuid", { def: UUID }),
      c("business_id", "uuid"),
      c("branch_id", "uuid"),
      c("order_id", "uuid", { null: true }),
      c("folio", "text", { def: v("") }),
      c("stars", "int"),
      c("comment", "text", { def: v("") }),
      c("customer_name", "text", { def: v("") }),
      c("customer_phone", "text", { def: v("") }),
      c("status", "text", { def: v("nueva") }),
      c("answer", "text", { def: v("") }),
      c("attended_by", "text", { def: v("") }),
      c("attended_at", "ts", { null: true }),
      c("created_at", "ts", { def: NOW }),
      c("updated_at", "ts", { def: NOW }),
    ],
    ["id"],
    { unique: [["order_id"]], indexes: ["(branch_id, created_at DESC)"], checks: ["stars BETWEEN 1 AND 5", oneOf("status", ["nueva", "atendida"])] }
  ),
  t(
    "bpos_service_catalog",
    [c("service", "text"), c("price", "num", { def: v(0) }), c("trial_days", "int", { def: v(14) }), c("ai_budget_usd", "num", { def: v(2) }), c("active", "bool", { def: v(true) }), c("updated_by", "text", { def: v("") }), c("updated_at", "ts", { def: NOW })],
    ["service"],
    { checks: [oneOf("service", ["lealtad", "menu", "kiosco", "asesor", "foodcost", "checador"]), "price >= 0", "trial_days BETWEEN 0 AND 90", "ai_budget_usd >= 0"] }
  ),
  t(
    "bpos_services",
    [
      c("business_id", "uuid"),
      c("service", "text"),
      c("status", "text", { def: v("trial") }),
      c("trial_ends_at", "ts", { null: true }),
      c("paid_until", "ts", { null: true }),
      c("mp_preapproval_id", "text", { null: true }),
      c("mp_payer_email", "text", { null: true }),
      c("created_at", "ts", { def: NOW }),
      c("updated_at", "ts", { def: NOW }),
    ],
    ["business_id", "service"],
    { checks: [oneOf("service", ["lealtad", "menu", "kiosco", "asesor", "foodcost", "checador"]), oneOf("status", ["trial", "active", "past_due", "cancelled"])] }
  ),
  t(
    "bpos_signup_codes",
    [c("id", "uuid", { def: UUID }), c("email", "text"), c("code_hash", "text"), c("attempts", "int", { def: v(0) }), c("expires_at", "ts"), c("used_at", "ts", { null: true }), c("created_at", "ts", { def: NOW })],
    ["id"],
    { indexes: ["(email, created_at DESC)"] }
  ),
  t(
    "bpos_task_evidence",
    [
      c("token", "text"),
      c("business_id", "uuid"),
      c("branch_id", "uuid", { null: true }),
      c("title", "text", { def: v("") }),
      c("photo_url", "text", { null: true }),
      c("created_at", "ts", { def: NOW }),
      c("uploaded_at", "ts", { null: true }),
      c("items", "json", { null: true }),
    ],
    ["token"],
    { indexes: ["(created_at)"] }
  ),
  t(
    "bpos_waiter_codes",
    [c("code", "text"), c("business_id", "uuid"), c("branch_id", "uuid"), c("created_by", "uuid", { null: true }), c("expires_at", "ts"), c("used_at", "ts", { null: true }), c("kind", "text", { def: v("mesero") })],
    ["code"]
  ),
  t(
    "bpos_waiter_devices",
    [
      c("id", "uuid", { def: UUID }),
      c("business_id", "uuid"),
      c("branch_id", "uuid"),
      c("user_id", "uuid"),
      c("name", "text", { def: v("") }),
      c("created_at", "ts", { def: NOW }),
      c("last_seen_at", "ts", { null: true }),
      c("revoked_at", "ts", { null: true }),
      c("kind", "text", { def: v("mesero") }),
    ],
    ["id"],
    { unique: [["user_id"]], indexes: ["(branch_id)", "(branch_id, kind)"] }
  ),
  t(
    "branches",
    [
      c("id", "uuid", { def: UUID }),
      c("business_id", "uuid"),
      c("name", "text"),
      c("address", "text", { def: v("") }),
      c("phone", "text", { def: v("") }),
      c("report_whatsapp", "text", { def: v("") }),
      c("ticket_footer", "text", { def: v("") }),
      c("created_at", "ts", { def: NOW }),
    ],
    ["id"],
    { indexes: ["(business_id)"], checks: ["length(trim(name)) > 0"] }
  ),
  t(
    "business_members",
    [c("business_id", "uuid"), c("user_id", "uuid"), c("role", "text", { def: v("owner") }), c("created_at", "ts", { def: NOW })],
    ["business_id", "user_id"],
    { indexes: ["(user_id)"], checks: [oneOf("role", ["owner", "admin", "device"])] }
  ),
  t(
    "businesses",
    [
      c("id", "uuid", { def: UUID }),
      c("name", "text"),
      c("plan", "text", { def: v("basic") }),
      c("owner_id", "uuid", { null: true }),
      c("created_at", "ts", { def: NOW }),
      c("plan_status", "text", { def: v("trial") }),
      c("trial_ends_at", "ts", { def: { kind: "nowPlusDays", days: 14 } }),
      c("paid_until", "ts", { null: true }),
      c("branches_paid", "int", { def: v(1) }),
      c("ai_budget_usd", "num", { null: true }),
      c("mp_preapproval_id", "text", { null: true }),
      c("mp_payer_email", "text", { null: true }),
      c("plan_updated_at", "ts", { null: true }),
      c("account_kind", "text", { def: v("pos") }),
      c("billing_period", "text", { def: v("monthly") }),
    ],
    ["id"],
    {
      checks: [
        "length(trim(name)) > 0",
        oneOf("plan", ["basic", "pro", "max"]),
        oneOf("plan_status", ["trial", "active", "past_due", "cancelled"]),
        oneOf("account_kind", ["pos", "servicios"]),
        oneOf("billing_period", ["monthly", "annual"]),
      ],
    }
  ),
  t("platform_admins", [c("user_id", "uuid"), c("created_at", "ts", { def: NOW })], ["user_id"]),
  t("push_log", [c("business_id", "uuid"), c("event_id", "text"), c("sent_at", "ts", { def: NOW })], ["business_id", "event_id"]),
  t(
    "push_subscriptions",
    [
      c("id", "int", { def: { kind: "identity" } }),
      c("business_id", "uuid"),
      c("endpoint", "text"),
      c("p256dh", "text"),
      c("auth", "text"),
      c("device_name", "text", { null: true }),
      c("prefs", "json", { def: v({}) }),
      c("created_at", "ts", { def: NOW }),
      c("updated_at", "ts", { def: NOW }),
    ],
    ["id"],
    { unique: [["endpoint"]], indexes: ["(business_id)"] }
  ),
  t("sync_heads", [c("business_id", "uuid"), c("seq", "int", { def: v(0) }), c("updated_at", "ts", { def: NOW })], ["business_id"]),
  t(
    "sync_records",
    [
      c("business_id", "uuid"),
      c("scope", "text"),
      c("collection", "text"),
      c("record_id", "text"),
      c("data", "json", { null: true }),
      c("deleted", "bool", { def: v(false) }),
      c("seq", "int", { def: { kind: "seq", name: "sync_seq" } }),
      c("updated_at", "ts", { def: NOW }),
      c("updated_by", "text", { def: v("") }),
    ],
    ["business_id", "scope", "collection", "record_id"],
    { indexes: ["(business_id, seq)"] }
  ),
];

export const TABLE = new Map(TABLES.map((x) => [x.name, x]));

/** Relaciones para los embebidos del REST: tabla → { tabla de la relación: [columna local, columna de la otra] } */
export const RELATIONS: Record<string, Record<string, [string, string]>> = {
  business_members: { businesses: ["business_id", "id"] },
  bpos_loyalty_members: { bpos_customer_accounts: ["account_id", "id"] },
  branches: { businesses: ["business_id", "id"] },
};

// ------------------------------------------------------------ esquema de D1

const SQL_TYPE: Record<ColType, string> = { uuid: "TEXT", text: "TEXT", int: "INTEGER", num: "REAL", bool: "INTEGER", json: "TEXT", ts: "TEXT", date: "TEXT" };

function sqlDefault(col: Column) {
  const d = col.default;
  if (!d) return "";
  if (d.kind === "value") {
    const value = d.value;
    if (typeof value === "boolean") return ` DEFAULT ${value ? 1 : 0}`;
    if (typeof value === "number") return ` DEFAULT ${value}`;
    if (typeof value === "string") return ` DEFAULT '${value.replace(/'/g, "''")}'`;
    return ` DEFAULT '${JSON.stringify(value).replace(/'/g, "''")}'`;
  }
  // uuid, now, uid, seq… los pone la nube al escribir (nube/rest.ts)
  return "";
}

/** CREATE TABLE de todas las tablas (más las propias de la nube: usuarios, sesiones, secuencias) */
export function schemaSql() {
  const out: string[] = [];
  for (const table of TABLES) {
    const identity = table.columns.find((col) => col.default?.kind === "identity");
    const lines = table.columns.map((col) => {
      if (identity && col.name === identity.name) return `  ${col.name} INTEGER PRIMARY KEY AUTOINCREMENT`;
      return `  ${col.name} ${SQL_TYPE[col.type]}${col.nullable ? "" : " NOT NULL"}${sqlDefault(col)}`;
    });
    if (!identity) lines.push(`  PRIMARY KEY (${table.pk.join(", ")})`);
    for (const u of table.unique) lines.push(`  UNIQUE (${u.join(", ")})`);
    for (const check of table.checks) lines.push(`  CHECK (${check})`);
    out.push(`CREATE TABLE IF NOT EXISTS ${table.name} (\n${lines.join(",\n")}\n);`);
    table.indexes.forEach((idx, i) => {
      const unique = idx.startsWith("UNIQUE ");
      const body = unique ? idx.slice(7) : idx;
      out.push(`CREATE ${unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${table.name}_i${i} ON ${table.name} ${body};`);
    });
  }
  out.push(NUBE_TABLES);
  return out.join("\n\n") + "\n";
}

/** Tablas de la nube misma: usuarios (en lugar de auth.users), sesiones y secuencias */
const NUBE_TABLES = `CREATE TABLE IF NOT EXISTS nube_users (
  id TEXT NOT NULL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  encrypted_password TEXT NOT NULL DEFAULT '',
  email_confirmed_at TEXT,
  user_metadata TEXT NOT NULL DEFAULT '{}',
  app_metadata TEXT NOT NULL DEFAULT '{}',
  banned_until TEXT,
  last_sign_in_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nube_refresh_tokens (
  token TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS nube_refresh_tokens_session ON nube_refresh_tokens (session_id);

CREATE TABLE IF NOT EXISTS nube_sequences (
  name TEXT NOT NULL PRIMARY KEY,
  value INTEGER NOT NULL
);`;
