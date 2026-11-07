-- =============================================================
-- B-POS · Servicios por separado (bpos.com.mx/servicios)
--
-- Además de los planes completos (Basic, Pro, Max), un restaurante puede
-- contratar servicios sueltos: tarjetas de lealtad, menú digital (con el
-- kiosco como extra), asesor con IA, food cost guiado y reloj checador.
--
-- 1. businesses.account_kind: 'pos' (B-POS completo, como siempre) o
--    'servicios' (solo lo contratado; entra por /servicios/login).
-- 2. bpos_service_catalog: precio al mes, días de prueba y presupuesto de
--    IA de cada servicio. Lo cambia el dueño de B-POS en Configuración →
--    Administrador → Servicios. Cualquiera lo puede leer (precios públicos).
-- 3. bpos_services: qué servicio tiene cada negocio y hasta cuándo (prueba,
--    activo con Mercado Pago, pago pendiente o cancelado). Solo el servidor
--    lo escribe (llave de servicio); los del negocio lo pueden leer.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede correr más de una vez.
-- =============================================================

alter table public.businesses add column if not exists account_kind text not null default 'pos';
alter table public.businesses drop constraint if exists businesses_account_kind_check;
alter table public.businesses add constraint businesses_account_kind_check check (account_kind in ('pos', 'servicios'));

-- ---------------------------------------------------------------- catálogo
create table if not exists public.bpos_service_catalog (
  service        text primary key check (service in ('lealtad', 'menu', 'kiosco', 'asesor', 'foodcost', 'checador')),
  price          numeric(10,2) not null default 0 check (price >= 0),
  trial_days     integer not null default 14 check (trial_days between 0 and 90),
  ai_budget_usd  numeric(10,2) not null default 2 check (ai_budget_usd >= 0),
  active         boolean not null default true,
  updated_by     text not null default '',
  updated_at     timestamptz not null default now()
);

insert into public.bpos_service_catalog (service, price) values
  ('lealtad', 199), ('menu', 249), ('kiosco', 199), ('asesor', 249), ('foodcost', 149), ('checador', 99)
on conflict (service) do nothing;

alter table public.bpos_service_catalog enable row level security;
drop policy if exists bpos_service_catalog_read on public.bpos_service_catalog;
create policy bpos_service_catalog_read on public.bpos_service_catalog for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.bpos_service_catalog from anon, authenticated;
grant select on public.bpos_service_catalog to anon, authenticated;

-- ---------------------------------------------------------------- contratados
create table if not exists public.bpos_services (
  business_id       uuid not null references public.businesses (id) on delete cascade,
  service           text not null check (service in ('lealtad', 'menu', 'kiosco', 'asesor', 'foodcost', 'checador')),
  status            text not null default 'trial' check (status in ('trial', 'active', 'past_due', 'cancelled')),
  trial_ends_at     timestamptz,
  paid_until        timestamptz,
  mp_preapproval_id text,
  mp_payer_email    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (business_id, service)
);

alter table public.bpos_services enable row level security;
drop policy if exists bpos_services_member_read on public.bpos_services;
create policy bpos_services_member_read on public.bpos_services
  for select to authenticated using (public.is_member(business_id) or public.is_platform_admin());
revoke all on public.bpos_services from anon;
revoke insert, update, delete, truncate on public.bpos_services from authenticated;
grant select on public.bpos_services to authenticated;
