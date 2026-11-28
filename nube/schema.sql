-- Generado por scripts/nube-esquema.ts a partir de nube/tables.ts. No editar a mano.

CREATE TABLE IF NOT EXISTS ai_usage (
  business_id TEXT NOT NULL,
  month TEXT NOT NULL,
  cost_usd REAL NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (business_id, month)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id TEXT NOT NULL,
  branch_id TEXT,
  event_id TEXT NOT NULL,
  category TEXT NOT NULL,
  action TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  user_name TEXT,
  user_id TEXT,
  entity_id TEXT,
  device_id TEXT,
  metadata TEXT,
  happened_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE (business_id, event_id)
);

CREATE INDEX IF NOT EXISTS audit_events_i0 ON audit_events (business_id, happened_at DESC);

CREATE TABLE IF NOT EXISTS bpos_advisor_weekly (
  business_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  email TEXT NOT NULL DEFAULT '',
  metrics TEXT,
  metrics_at TEXT,
  last_week TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  last_analysis_at TEXT,
  PRIMARY KEY (business_id)
);

CREATE TABLE IF NOT EXISTS bpos_agent_codes (
  code TEXT NOT NULL,
  business_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  created_by TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  kiosk_id TEXT,
  PRIMARY KEY (code)
);

CREATE TABLE IF NOT EXISTS bpos_agent_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT,
  agent_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  taken_at TEXT,
  done_at TEXT,
  target_agent TEXT,
  CHECK (status IN ('pending', 'taken', 'done', 'error')),
  CHECK (kind IN ('print-tickets', 'print-original', 'station-printers', 'print', 'open-drawer'))
);

CREATE INDEX IF NOT EXISTS bpos_agent_jobs_i0 ON bpos_agent_jobs (branch_id, status, created_at);

CREATE TABLE IF NOT EXISTS bpos_agents (
  id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  printers TEXT NOT NULL DEFAULT '[]',
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  kiosk_id TEXT,
  PRIMARY KEY (id),
  UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS bpos_agents_i0 ON bpos_agents (branch_id);

CREATE TABLE IF NOT EXISTS bpos_ai_credits (
  business_id TEXT NOT NULL,
  day TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (business_id, day),
  CHECK (used >= 0)
);

CREATE TABLE IF NOT EXISTS bpos_ai_image_settings (
  feature TEXT NOT NULL DEFAULT 'fotos',
  provider TEXT NOT NULL DEFAULT 'openai',
  model TEXT NOT NULL DEFAULT 'gpt-image-1',
  key_cipher TEXT NOT NULL DEFAULT '',
  key_hint TEXT NOT NULL DEFAULT '',
  price_in REAL NOT NULL DEFAULT 0,
  price_out REAL NOT NULL DEFAULT 0,
  credits_per_day INTEGER NOT NULL DEFAULT 25,
  credits_per_use INTEGER NOT NULL DEFAULT 5,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  prompt_keep TEXT NOT NULL DEFAULT '',
  prompt_remove TEXT NOT NULL DEFAULT '',
  credits_period TEXT NOT NULL DEFAULT 'dia',
  PRIMARY KEY (feature),
  CHECK (feature = 'fotos'),
  CHECK (provider IN ('openai', 'gemini')),
  CHECK (credits_per_day >= 0),
  CHECK (credits_per_use > 0),
  CHECK (credits_period IN ('dia', 'semana', 'mes'))
);

CREATE TABLE IF NOT EXISTS bpos_ai_settings (
  feature TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  key_cipher TEXT NOT NULL DEFAULT '',
  key_hint TEXT NOT NULL DEFAULT '',
  price_in REAL NOT NULL DEFAULT 0,
  price_out REAL NOT NULL DEFAULT 0,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  refresh_days INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (feature),
  CHECK (feature IN ('interprete', 'asesor')),
  CHECK (provider IN ('anthropic', 'gemini')),
  CHECK (refresh_days IN (0, 1, 3, 7))
);

CREATE TABLE IF NOT EXISTS bpos_backups (
  business_id TEXT NOT NULL,
  day TEXT NOT NULL,
  data TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (business_id, day)
);

CREATE TABLE IF NOT EXISTS bpos_bridge_aliases (
  business_id TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (business_id, id)
);

CREATE TABLE IF NOT EXISTS bpos_bridge_orders (
  business_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  order_key TEXT NOT NULL,
  data TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Recibido',
  received_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (branch_id, order_key)
);

CREATE INDEX IF NOT EXISTS bpos_bridge_orders_i0 ON bpos_bridge_orders (branch_id, received_at DESC);

CREATE TABLE IF NOT EXISTS bpos_customer_accounts (
  id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL DEFAULT '',
  email_verified_at TEXT,
  address TEXT NOT NULL DEFAULT '{}',
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (business_id, phone),
  CHECK (length(phone) = 10 AND phone NOT GLOB '*[^0-9]*')
);

CREATE TABLE IF NOT EXISTS bpos_customer_codes (
  id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id),
  CHECK (purpose IN ('verificar', 'contrasena'))
);

CREATE INDEX IF NOT EXISTS bpos_customer_codes_i0 ON bpos_customer_codes (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bpos_customer_sessions (
  token_hash TEXT NOT NULL,
  account_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (token_hash)
);

CREATE INDEX IF NOT EXISTS bpos_customer_sessions_i0 ON bpos_customer_sessions (account_id);

CREATE TABLE IF NOT EXISTS bpos_kiosk_codes (
  code TEXT NOT NULL,
  business_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  created_by TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  PRIMARY KEY (code)
);

CREATE TABLE IF NOT EXISTS bpos_kiosks (
  id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL,
  terminal_id TEXT NOT NULL DEFAULT '',
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  printer TEXT NOT NULL DEFAULT '',
  paper_mm INTEGER NOT NULL DEFAULT 80,
  PRIMARY KEY (id),
  UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS bpos_kiosks_i0 ON bpos_kiosks (branch_id);

CREATE TABLE IF NOT EXISTS bpos_license_keys (
  id INTEGER NOT NULL DEFAULT 1,
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id),
  CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS bpos_loyalty_members (
  account_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  code TEXT NOT NULL,
  points REAL NOT NULL DEFAULT 0,
  stamps INTEGER NOT NULL DEFAULT 0,
  cashback REAL NOT NULL DEFAULT 0,
  wallet_saved INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id),
  UNIQUE (business_id, code)
);

CREATE TABLE IF NOT EXISTS bpos_loyalty_movements (
  id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  points REAL NOT NULL DEFAULT 0,
  stamps INTEGER NOT NULL DEFAULT 0,
  cashback REAL NOT NULL DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0,
  ref TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (id),
  CHECK (kind IN ('bienvenida', 'compra', 'canje', 'ajuste'))
);

CREATE INDEX IF NOT EXISTS bpos_loyalty_movements_i0 ON bpos_loyalty_movements (account_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS bpos_loyalty_movements_i1 ON bpos_loyalty_movements (account_id, kind, ref) WHERE ref <> '';

CREATE TABLE IF NOT EXISTS bpos_menu_links (
  slug TEXT NOT NULL,
  business_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (slug),
  UNIQUE (branch_id),
  CHECK (length(slug) BETWEEN 3 AND 40 AND slug NOT GLOB '*[^a-z0-9-]*' AND slug NOT GLOB '-*' AND slug NOT GLOB '*-')
);

CREATE TABLE IF NOT EXISTS bpos_mp_accounts (
  business_id TEXT NOT NULL,
  mp_user_id TEXT NOT NULL,
  nickname TEXT NOT NULL DEFAULT '',
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL DEFAULT '',
  expires_at TEXT,
  live_mode INTEGER NOT NULL DEFAULT 1,
  linked_by TEXT,
  linked_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (business_id)
);

CREATE TABLE IF NOT EXISTS bpos_mp_charges (
  id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  amount REAL NOT NULL,
  reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS bpos_mp_charges_i0 ON bpos_mp_charges (branch_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bpos_mp_link_states (
  state TEXT NOT NULL,
  business_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (state)
);

CREATE TABLE IF NOT EXISTS bpos_mp_terminals (
  branch_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  terminal_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (branch_id)
);

CREATE TABLE IF NOT EXISTS bpos_online_orders (
  id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  folio TEXT NOT NULL,
  token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'nuevo',
  data TEXT NOT NULL,
  sale_order_id INTEGER,
  eta_minutes INTEGER,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  account_id TEXT,
  PRIMARY KEY (id),
  CHECK (status IN ('nuevo', 'aceptando', 'aceptado', 'rechazado', 'listo', 'entregado'))
);

CREATE INDEX IF NOT EXISTS bpos_online_orders_i0 ON bpos_online_orders (branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS bpos_online_orders_i1 ON bpos_online_orders (branch_id) WHERE status IN ('nuevo', 'aceptando');

CREATE INDEX IF NOT EXISTS bpos_online_orders_i2 ON bpos_online_orders (account_id, created_at DESC) WHERE account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS bpos_reservations (
  id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  token TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL DEFAULT '',
  people INTEGER NOT NULL,
  reserved_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'nueva',
  reason TEXT NOT NULL DEFAULT '',
  attended_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (id),
  CHECK (people BETWEEN 1 AND 100),
  CHECK (status IN ('nueva', 'confirmada', 'rechazada', 'cancelada', 'llego', 'no_llego'))
);

CREATE INDEX IF NOT EXISTS bpos_reservations_i0 ON bpos_reservations (branch_id, reserved_at DESC);

CREATE TABLE IF NOT EXISTS bpos_reviews (
  id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  order_id TEXT,
  folio TEXT NOT NULL DEFAULT '',
  stars INTEGER NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'nueva',
  answer TEXT NOT NULL DEFAULT '',
  attended_by TEXT NOT NULL DEFAULT '',
  attended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (order_id),
  CHECK (stars BETWEEN 1 AND 5),
  CHECK (status IN ('nueva', 'atendida'))
);

CREATE INDEX IF NOT EXISTS bpos_reviews_i0 ON bpos_reviews (branch_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bpos_service_catalog (
  service TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  trial_days INTEGER NOT NULL DEFAULT 14,
  ai_budget_usd REAL NOT NULL DEFAULT 2,
  active INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (service),
  CHECK (service IN ('lealtad', 'menu', 'kiosco', 'asesor', 'foodcost', 'checador')),
  CHECK (price >= 0),
  CHECK (trial_days BETWEEN 0 AND 90),
  CHECK (ai_budget_usd >= 0)
);

CREATE TABLE IF NOT EXISTS bpos_services (
  business_id TEXT NOT NULL,
  service TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'trial',
  trial_ends_at TEXT,
  paid_until TEXT,
  mp_preapproval_id TEXT,
  mp_payer_email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (business_id, service),
  CHECK (service IN ('lealtad', 'menu', 'kiosco', 'asesor', 'foodcost', 'checador')),
  CHECK (status IN ('trial', 'active', 'past_due', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS bpos_signup_codes (
  id TEXT NOT NULL,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS bpos_signup_codes_i0 ON bpos_signup_codes (email, created_at DESC);

CREATE TABLE IF NOT EXISTS bpos_task_evidence (
  token TEXT NOT NULL,
  business_id TEXT NOT NULL,
  branch_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  photo_url TEXT,
  created_at TEXT NOT NULL,
  uploaded_at TEXT,
  items TEXT,
  PRIMARY KEY (token)
);

CREATE INDEX IF NOT EXISTS bpos_task_evidence_i0 ON bpos_task_evidence (created_at);

CREATE TABLE IF NOT EXISTS bpos_waiter_codes (
  code TEXT NOT NULL,
  business_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  created_by TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  kind TEXT NOT NULL DEFAULT 'mesero',
  PRIMARY KEY (code)
);

CREATE TABLE IF NOT EXISTS bpos_waiter_devices (
  id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT,
  kind TEXT NOT NULL DEFAULT 'mesero',
  PRIMARY KEY (id),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS bpos_waiter_devices_i0 ON bpos_waiter_devices (branch_id);

CREATE INDEX IF NOT EXISTS bpos_waiter_devices_i1 ON bpos_waiter_devices (branch_id, kind);

CREATE TABLE IF NOT EXISTS branches (
  id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  report_whatsapp TEXT NOT NULL DEFAULT '',
  ticket_footer TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (id),
  CHECK (length(trim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS branches_i0 ON branches (business_id);

CREATE TABLE IF NOT EXISTS business_members (
  business_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL,
  PRIMARY KEY (business_id, user_id),
  CHECK (role IN ('owner', 'admin', 'device'))
);

CREATE INDEX IF NOT EXISTS business_members_i0 ON business_members (user_id);

CREATE TABLE IF NOT EXISTS businesses (
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'basic',
  owner_id TEXT,
  created_at TEXT NOT NULL,
  plan_status TEXT NOT NULL DEFAULT 'trial',
  trial_ends_at TEXT NOT NULL,
  paid_until TEXT,
  branches_paid INTEGER NOT NULL DEFAULT 1,
  ai_budget_usd REAL,
  mp_preapproval_id TEXT,
  mp_payer_email TEXT,
  plan_updated_at TEXT,
  account_kind TEXT NOT NULL DEFAULT 'pos',
  billing_period TEXT NOT NULL DEFAULT 'monthly',
  PRIMARY KEY (id),
  CHECK (length(trim(name)) > 0),
  CHECK (plan IN ('basic', 'pro', 'max')),
  CHECK (plan_status IN ('trial', 'active', 'past_due', 'cancelled')),
  CHECK (account_kind IN ('pos', 'servicios')),
  CHECK (billing_period IN ('monthly', 'annual'))
);

CREATE TABLE IF NOT EXISTS platform_admins (
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id)
);

CREATE TABLE IF NOT EXISTS push_log (
  business_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (business_id, event_id)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  device_name TEXT,
  prefs TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS push_subscriptions_i0 ON push_subscriptions (business_id);

CREATE TABLE IF NOT EXISTS sync_heads (
  business_id TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (business_id)
);

CREATE TABLE IF NOT EXISTS sync_records (
  business_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  collection TEXT NOT NULL,
  record_id TEXT NOT NULL,
  data TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (business_id, scope, collection, record_id)
);

CREATE INDEX IF NOT EXISTS sync_records_i0 ON sync_records (business_id, seq);

CREATE TABLE IF NOT EXISTS nube_users (
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
);

CREATE TABLE IF NOT EXISTS nube_devices (
  business_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  branch_id TEXT,
  user_id TEXT NOT NULL,
  email TEXT,
  name TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'navegador',
  session_id TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip TEXT,
  city TEXT,
  region TEXT,
  country TEXT,
  revoked_at TEXT,
  revoked_session TEXT,
  PRIMARY KEY (business_id, device_id)
);

CREATE TABLE IF NOT EXISTS nube_branch_primary (
  business_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  device_id TEXT,
  set_at TEXT NOT NULL,
  set_by TEXT,
  PRIMARY KEY (business_id, branch_id)
);
