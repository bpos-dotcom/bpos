-- =============================================================
-- B-POS · Estudio de fotos con IA (plan Max)
--
-- bpos_ai_photo_settings: modelo y clave del Estudio de fotos (las mismas
-- columnas que bpos_ai_settings, 0017) y los BPOS Credits: cuántos tiene
-- cada negocio al día y cuántos gasta cada foto. Tabla aparte para no
-- tocar la regla de funciones de bpos_ai_settings.
--
-- bpos_ai_credits: BPOS Credits gastados por negocio y día (hora de
-- México). bpos_ai_credits_spend descuenta solo si alcanzan (en una sola
-- operación, así dos fotos al mismo tiempo no se pasan del límite) y
-- bpos_ai_credits_refund regresa los de una foto que falló.
--
-- Sin políticas: solo el servidor de B-POS (llave de servicio) las lee y
-- escribe. La clave nunca regresa al navegador.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede correr más de una vez.
-- =============================================================

create table if not exists public.bpos_ai_photo_settings (
  feature          text primary key default 'fotos' check (feature = 'fotos'),
  provider         text not null default 'gemini' check (provider in ('anthropic', 'gemini')),
  model            text not null default 'gemini-2.5-flash-image',
  key_cipher       text not null default '',
  key_hint         text not null default '',
  price_in         numeric not null default 0,
  price_out        numeric not null default 0,
  credits_per_day  integer not null default 25 check (credits_per_day >= 0),
  credits_per_use  integer not null default 5 check (credits_per_use > 0),
  updated_by       text not null default '',
  updated_at       timestamptz not null default now()
);

alter table public.bpos_ai_photo_settings enable row level security;

create table if not exists public.bpos_ai_credits (
  business_id  uuid not null,
  day          date not null,
  used         integer not null default 0 check (used >= 0),
  updated_at   timestamptz not null default now(),
  primary key (business_id, day)
);

alter table public.bpos_ai_credits enable row level security;

-- Gasta p_cost créditos si no se pasa de p_limit. Regresa los usados del día, o -1 si no alcanzan.
create or replace function public.bpos_ai_credits_spend(p_business_id uuid, p_day date, p_cost integer, p_limit integer)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v integer;
begin
  if p_cost is null or p_cost <= 0 or p_limit is null or p_cost > p_limit then
    return -1;
  end if;
  insert into bpos_ai_credits as c (business_id, day, used, updated_at)
  values (p_business_id, p_day, p_cost, now())
  on conflict (business_id, day) do update
    set used = c.used + excluded.used, updated_at = now()
    where c.used + excluded.used <= p_limit
  returning used into v;
  return coalesce(v, -1);
end;
$$;

-- Regresa los créditos de una foto que no salió
create or replace function public.bpos_ai_credits_refund(p_business_id uuid, p_day date, p_cost integer)
returns void
language plpgsql
set search_path = public
as $$
begin
  update bpos_ai_credits
     set used = greatest(0, used - greatest(0, coalesce(p_cost, 0))), updated_at = now()
   where business_id = p_business_id and day = p_day;
end;
$$;
