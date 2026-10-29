-- =====================================================================
-- B-POS · Bloque 15 · Planes (Basic, Pro, Max), prueba gratis y uso de IA
-- ---------------------------------------------------------------------
-- 1. businesses: plan, estado de la suscripción, días de prueba, sucursales
--    pagadas y datos de Mercado Pago. El dueño del negocio NO puede cambiar
--    esto (lo protege un trigger): solo el servidor (Mercado Pago) o un
--    administrador de la plataforma.
-- 2. platform_admins: quién administra B-POS (panel de la plataforma).
-- 3. ai_usage: cuánto gasta cada negocio en IA por mes. Solo se suma con
--    bpos_ai_charge (no se puede editar ni borrar desde la app).
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede correr más de una vez.
-- =====================================================================

-- ---------------------------------------------------------------- planes
alter table public.businesses add column if not exists plan_status text not null default 'trial';
alter table public.businesses add column if not exists trial_ends_at timestamptz not null default (now() + interval '14 days');
alter table public.businesses add column if not exists paid_until timestamptz;
alter table public.businesses add column if not exists branches_paid integer not null default 1;
alter table public.businesses add column if not exists ai_budget_usd numeric(10,2); -- null = el del plan
alter table public.businesses add column if not exists mp_preapproval_id text;
alter table public.businesses add column if not exists mp_payer_email text;
alter table public.businesses add column if not exists plan_updated_at timestamptz;

update public.businesses set plan = 'basic' where plan is null or plan not in ('basic', 'pro', 'max');
alter table public.businesses alter column plan set default 'basic';

alter table public.businesses drop constraint if exists businesses_plan_check;
alter table public.businesses add constraint businesses_plan_check check (plan in ('basic', 'pro', 'max'));
alter table public.businesses drop constraint if exists businesses_plan_status_check;
alter table public.businesses add constraint businesses_plan_status_check check (plan_status in ('trial', 'active', 'past_due', 'cancelled'));

-- ---------------------------------------------------------------- admins
create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
drop policy if exists platform_admins_self on public.platform_admins;
create policy platform_admins_self on public.platform_admins
  for select to authenticated using (user_id = auth.uid());
revoke all on public.platform_admins from anon;
revoke insert, update, delete on public.platform_admins from authenticated;
grant select on public.platform_admins to authenticated;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;
grant execute on function public.is_platform_admin() to authenticated;

-- Los administradores ven todos los negocios
drop policy if exists businesses_admin_select on public.businesses;
create policy businesses_admin_select on public.businesses
  for select to authenticated using (public.is_platform_admin());

-- El dueño no puede cambiarse el plan ni la suscripción
create or replace function public.businesses_protect_plan()
returns trigger
language plpgsql
as $$
begin
  -- El servidor (service_role), el SQL Editor (postgres) y los administradores sí pueden
  if coalesce(auth.role(), '') = 'service_role' or current_user not in ('authenticated', 'anon') or public.is_platform_admin() then
    if new.plan is distinct from old.plan or new.plan_status is distinct from old.plan_status then
      new.plan_updated_at := now();
    end if;
    return new;
  end if;
  new.plan := old.plan;
  new.plan_status := old.plan_status;
  new.trial_ends_at := old.trial_ends_at;
  new.paid_until := old.paid_until;
  new.branches_paid := old.branches_paid;
  new.ai_budget_usd := old.ai_budget_usd;
  new.mp_preapproval_id := old.mp_preapproval_id;
  new.mp_payer_email := old.mp_payer_email;
  new.plan_updated_at := old.plan_updated_at;
  return new;
end;
$$;

drop trigger if exists businesses_protect_plan on public.businesses;
create trigger businesses_protect_plan
  before update on public.businesses
  for each row execute function public.businesses_protect_plan();

-- Un negocio nuevo empieza en Basic con 14 días de prueba (ni el dueño ni la app lo cambian al crearlo)
create or replace function public.businesses_new_trial()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user in ('authenticated', 'anon') and not public.is_platform_admin() then
    new.plan := 'basic';
    new.plan_status := 'trial';
    new.trial_ends_at := now() + interval '14 days';
    new.paid_until := null;
    new.branches_paid := 1;
    new.ai_budget_usd := null;
  end if;
  return new;
end;
$$;

drop trigger if exists businesses_new_trial on public.businesses;
create trigger businesses_new_trial
  before insert on public.businesses
  for each row execute function public.businesses_new_trial();

-- ---------------------------------------------------------------- IA
create table if not exists public.ai_usage (
  business_id uuid not null references public.businesses (id) on delete cascade,
  month       date not null,
  cost_usd    numeric(12,6) not null default 0,
  requests    integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (business_id, month)
);
alter table public.ai_usage enable row level security;
drop policy if exists ai_usage_select on public.ai_usage;
create policy ai_usage_select on public.ai_usage
  for select to authenticated using (public.is_member(business_id) or public.is_platform_admin());
revoke all on public.ai_usage from anon;
revoke insert, update, delete, truncate on public.ai_usage from authenticated;
grant select on public.ai_usage to authenticated;

-- Presupuesto mensual de IA en dólares: el del negocio o el de su plan
create or replace function public.bpos_ai_budget(p_plan text, p_override numeric)
returns numeric
language sql
immutable
as $$
  select coalesce(p_override, case p_plan when 'max' then 5.00 else 0 end);
$$;

-- ¿Puede usar IA ahora? (plan, estado, presupuesto y gasto del mes)
create or replace function public.bpos_ai_allowance(p_business_id uuid)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b businesses;
  spent numeric;
  active boolean;
begin
  if not (public.is_member(p_business_id) or public.is_platform_admin()) then
    raise exception 'SIN_ACCESO' using errcode = '42501';
  end if;
  select * into b from businesses where id = p_business_id;
  select coalesce(cost_usd, 0) into spent from ai_usage where business_id = p_business_id and month = date_trunc('month', now())::date;
  active := b.plan_status = 'active' or (b.plan_status = 'trial' and b.trial_ends_at > now());
  return json_build_object(
    'plan', b.plan,
    'status', b.plan_status,
    'active', active,
    'budget', public.bpos_ai_budget(b.plan, b.ai_budget_usd),
    'spent', coalesce(spent, 0)
  );
end;
$$;
grant execute on function public.bpos_ai_allowance(uuid) to authenticated;

-- Suma lo que costó una consulta de IA (solo suma; nadie puede restar)
create or replace function public.bpos_ai_charge(p_business_id uuid, p_cost numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_member(p_business_id) then
    raise exception 'SIN_ACCESO' using errcode = '42501';
  end if;
  if p_cost is null or p_cost < 0 or p_cost > 50 then
    raise exception 'Costo inválido';
  end if;
  insert into ai_usage (business_id, month, cost_usd, requests, updated_at)
  values (p_business_id, date_trunc('month', now())::date, p_cost, 1, now())
  on conflict (business_id, month)
  do update set cost_usd = ai_usage.cost_usd + excluded.cost_usd, requests = ai_usage.requests + 1, updated_at = now();
end;
$$;
grant execute on function public.bpos_ai_charge(uuid, numeric) to authenticated;
