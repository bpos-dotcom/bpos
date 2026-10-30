-- =============================================================
-- B-POS · Mercado Pago de cada negocio (Configuración → Métodos de pago)
--
-- El negocio vincula SU cuenta de Mercado Pago (OAuth): el dinero de sus
-- cobros llega directo a su cuenta. Con eso:
--   - cobra con su terminal Point desde el POS (la terminal se enciende
--     sola con el monto);
--   - más adelante, cobros en línea del menú digital.
--
-- Las llaves de Mercado Pago del negocio NUNCA salen de la nube: estas
-- tablas no tienen permisos para el navegador (solo el servidor de B-POS en
-- Vercel, con la llave de servicio, las lee).
-- =============================================================

create table if not exists public.bpos_mp_accounts (
  business_id   uuid primary key references public.businesses (id) on delete cascade,
  mp_user_id    text not null,
  nickname      text not null default '',
  access_token  text not null,
  refresh_token text not null default '',
  expires_at    timestamptz,
  live_mode     boolean not null default true,
  linked_by     uuid,
  linked_at     timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- "Vincular" en curso: el regreso de Mercado Pago solo vale con este estado
create table if not exists public.bpos_mp_link_states (
  state        text primary key,
  business_id  uuid not null references public.businesses (id) on delete cascade,
  user_id      uuid not null,
  created_at   timestamptz not null default now()
);

-- Terminal Point que usa cada sucursal
create table if not exists public.bpos_mp_terminals (
  branch_id    uuid primary key references public.branches (id) on delete cascade,
  business_id  uuid not null references public.businesses (id) on delete cascade,
  terminal_id  text not null,
  updated_at   timestamptz not null default now()
);

-- Cobros mandados a la terminal (para revisar cómo terminaron)
create table if not exists public.bpos_mp_charges (
  id           text primary key,              -- id de la orden en Mercado Pago
  business_id  uuid not null references public.businesses (id) on delete cascade,
  branch_id    uuid not null references public.branches (id) on delete cascade,
  amount       numeric(12, 2) not null,
  reference    text not null,
  status       text not null default 'created',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists bpos_mp_charges_branch_idx on public.bpos_mp_charges (branch_id, created_at desc);

alter table public.bpos_mp_accounts enable row level security;
alter table public.bpos_mp_link_states enable row level security;
alter table public.bpos_mp_terminals enable row level security;
alter table public.bpos_mp_charges enable row level security;

revoke all on public.bpos_mp_accounts from anon, authenticated;
revoke all on public.bpos_mp_link_states from anon, authenticated;
revoke all on public.bpos_mp_terminals from anon, authenticated;
revoke all on public.bpos_mp_charges from anon, authenticated;

-- Avisos con audio propio del negocio (Configuración → Notificaciones)
update storage.buckets
   set allowed_mime_types = array['image/jpeg','image/png','image/webp','audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/ogg','audio/mp4','audio/x-m4a','audio/webm']
 where id = 'bpos-media';
