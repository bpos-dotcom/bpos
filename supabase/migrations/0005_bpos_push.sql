-- =====================================================================
-- B-POS · Bloque 12 · Notificaciones push en el celular del dueño
-- ---------------------------------------------------------------------
-- 1. push_subscriptions: cada celular o computadora que activó los avisos
--    en la App del dueño (a dónde mandarlos y qué avisos quiere).
-- 2. push_log: eventos de la bitácora que ya se avisaron, para no mandar
--    el mismo aviso dos veces aunque varias cajas lo pidan.
--
-- Quien manda los avisos es B-POS en Vercel (app/api/push/notify), y solo
-- de eventos que ya están en audit_events (0004).
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede correr más de una vez.
-- =====================================================================

create table if not exists public.push_subscriptions (
  id           bigint generated always as identity primary key,
  business_id  uuid not null references public.businesses (id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  device_name  text,
  prefs        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists push_subscriptions_business_idx
  on public.push_subscriptions (business_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_member on public.push_subscriptions;
create policy push_subscriptions_member on public.push_subscriptions
  for all to authenticated
  using (public.is_member(business_id))
  with check (public.is_member(business_id));

revoke all on public.push_subscriptions from anon;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

create table if not exists public.push_log (
  business_id  uuid not null references public.businesses (id) on delete cascade,
  event_id     text not null,
  sent_at      timestamptz not null default now(),
  primary key (business_id, event_id)
);

alter table public.push_log enable row level security;

drop policy if exists push_log_insert on public.push_log;
create policy push_log_insert on public.push_log
  for insert to authenticated
  with check (public.is_member(business_id));

drop policy if exists push_log_select on public.push_log;
create policy push_log_select on public.push_log
  for select to authenticated
  using (public.is_member(business_id));

revoke all on public.push_log from anon;
revoke update, delete, truncate on public.push_log from authenticated;
grant select, insert on public.push_log to authenticated;
