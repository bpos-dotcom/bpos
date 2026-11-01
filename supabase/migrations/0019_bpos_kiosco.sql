-- =============================================================
-- B-POS · Kiosco de autoservicio (pantalla en el local)
--
-- El kiosco es el mismo menú digital de la sucursal, en una pantalla táctil
-- del local (bpos.com.mx/kiosco). El cliente arma su pedido y paga en una
-- terminal Point de Mercado Pago que se enciende sola con el monto; el
-- pedido entra a Pedidos en línea ya pagado.
--
-- 1. bpos_kiosks: cada pantalla vinculada a una sucursal (se guarda solo la
--    huella sha256 de su llave) y la terminal que le toca.
-- 2. bpos_kiosk_codes: códigos de 6 dígitos para vincular una pantalla desde
--    Configuración → Menú digital (duran 15 minutos y se usan una vez). Al
--    vincular, la pantalla pide el correo de una cuenta del negocio y el
--    código, para asegurar que es un código de ESE negocio.
--
-- El navegador no toca estas tablas: solo el servidor de B-POS (Vercel, con
-- la llave de servicio) las lee y escribe.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede correr más de una vez.
-- =============================================================

create table if not exists public.bpos_kiosks (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  branch_id     uuid not null references public.branches (id) on delete cascade,
  name          text not null default '',
  token_hash    text not null unique,
  terminal_id   text not null default '',
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz
);
create index if not exists bpos_kiosks_branch_idx on public.bpos_kiosks (branch_id);

create table if not exists public.bpos_kiosk_codes (
  code         text primary key,
  business_id  uuid not null references public.businesses (id) on delete cascade,
  branch_id    uuid not null references public.branches (id) on delete cascade,
  created_by   uuid,
  expires_at   timestamptz not null,
  used_at      timestamptz
);

alter table public.bpos_kiosks enable row level security;
alter table public.bpos_kiosk_codes enable row level security;
revoke all on public.bpos_kiosks from anon, authenticated;
revoke all on public.bpos_kiosk_codes from anon, authenticated;
