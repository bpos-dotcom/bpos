-- =============================================================
-- B-POS · Cuentas de clientes del menú digital
--
-- El cliente de cada restaurante se registra con nombre, teléfono, correo
-- y contraseña; el correo se verifica con un código (Resend). Con su cuenta
-- ve su historial de pedidos y después entrará al Club del restaurante
-- (bpos.com.mx/fidelidad/<liga>).
--
-- Las cuentas son por negocio. Solo el servidor de B-POS (Vercel, llave de
-- servicio) lee y escribe sesiones y códigos; los miembros del negocio
-- pueden ver sus clientes registrados.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede correr más de una vez (no borra nada).
-- =============================================================

create table if not exists public.bpos_customer_accounts (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses (id) on delete cascade,
  phone             text not null check (phone ~ '^[0-9]{10}$'),
  name              text not null default '',
  email             text not null default '',
  password_hash     text not null default '',
  email_verified_at timestamptz,
  address           jsonb not null default '{}'::jsonb,   -- última dirección de entrega
  failed_logins     int not null default 0,
  locked_until      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (business_id, phone)
);

-- Códigos de 6 dígitos que llegan por correo (verificar cuenta o cambiar contraseña)
create table if not exists public.bpos_customer_codes (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.bpos_customer_accounts (id) on delete cascade,
  purpose     text not null check (purpose in ('verificar', 'contrasena')),
  code_hash   text not null,
  attempts    int not null default 0,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists bpos_customer_codes_account_idx on public.bpos_customer_codes (account_id, created_at desc);

-- Sesiones del cliente en su celular (se guarda solo el hash de la llave)
create table if not exists public.bpos_customer_sessions (
  token_hash   text primary key,
  account_id   uuid not null references public.bpos_customer_accounts (id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null
);
create index if not exists bpos_customer_sessions_account_idx on public.bpos_customer_sessions (account_id);

alter table public.bpos_customer_accounts enable row level security;
alter table public.bpos_customer_codes enable row level security;
alter table public.bpos_customer_sessions enable row level security;

-- El negocio ve a sus clientes registrados (sin contraseñas: se leen por columnas)
do $pol$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'bpos_customer_accounts' and policyname = 'bpos_customer_accounts_member') then
    create policy bpos_customer_accounts_member on public.bpos_customer_accounts
      for select to authenticated
      using (public.is_member(business_id));
  end if;
end
$pol$;

-- Pedidos hechos con cuenta: así salen en "Mis pedidos"
alter table public.bpos_online_orders
  add column if not exists account_id uuid references public.bpos_customer_accounts (id) on delete set null;
create index if not exists bpos_online_orders_account_idx
  on public.bpos_online_orders (account_id, created_at desc) where account_id is not null;

-- Nota: los pedidos (con o sin cuenta) se siguen borrando a los 60 días
-- (bpos_menu_place_order de 0009), así que "Mis pedidos" muestra los últimos 60 días.
