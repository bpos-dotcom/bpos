-- =============================================================
-- B-POS · 0007 · Panel de administrador de la plataforma (bloque 15, fase 3)
-- Solo los usuarios de platform_admins (is_platform_admin) pueden usar estas
-- funciones: ver todos los negocios y cambiarles plan, estado, fecha pagada y
-- presupuesto de IA. Corren como security definer, así que el trigger
-- businesses_protect_plan las deja pasar.
-- =============================================================

create or replace function public.bpos_admin_businesses()
returns table (
  id uuid,
  name text,
  created_at timestamptz,
  plan text,
  plan_status text,
  trial_ends_at timestamptz,
  paid_until timestamptz,
  branches_paid int,
  branches int,
  ai_budget_usd numeric,
  ai_spent_usd numeric,
  ai_requests int,
  mp_preapproval_id text,
  mp_payer_email text,
  owner_email text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Solo el administrador de B-POS';
  end if;
  return query
  select
    b.id,
    b.name,
    b.created_at,
    b.plan,
    b.plan_status,
    b.trial_ends_at,
    b.paid_until,
    b.branches_paid,
    (select count(*)::int from branches br where br.business_id = b.id),
    b.ai_budget_usd,
    coalesce(u.cost_usd, 0),
    coalesce(u.requests, 0)::int,
    b.mp_preapproval_id,
    b.mp_payer_email,
    coalesce(
      (select au.email::text from auth.users au where au.id = b.owner_id),
      (select au.email::text
      from business_members m
      join auth.users au on au.id = m.user_id
      where m.business_id = b.id and m.role = 'owner'
      order by m.created_at
      limit 1)
    )
  from businesses b
  left join ai_usage u on u.business_id = b.id and u.month = date_trunc('month', now())::date
  order by b.created_at desc;
end;
$$;

create or replace function public.bpos_admin_update_business(
  p_business_id uuid,
  p_plan text,
  p_status text,
  p_trial_ends_at timestamptz,
  p_paid_until timestamptz,
  p_branches_paid int,
  p_ai_budget_usd numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Solo el administrador de B-POS';
  end if;
  if p_plan not in ('basic', 'pro', 'max') then
    raise exception 'Plan inválido';
  end if;
  if p_status not in ('trial', 'active', 'past_due', 'cancelled') then
    raise exception 'Estado inválido';
  end if;
  update businesses set
    plan = p_plan,
    plan_status = p_status,
    trial_ends_at = coalesce(p_trial_ends_at, trial_ends_at),
    paid_until = p_paid_until,
    branches_paid = greatest(1, coalesce(p_branches_paid, 1)),
    ai_budget_usd = p_ai_budget_usd,
    plan_updated_at = now()
  where id = p_business_id;
end;
$$;

revoke all on function public.bpos_admin_businesses() from public, anon;
revoke all on function public.bpos_admin_update_business(uuid, text, text, timestamptz, timestamptz, int, numeric) from public, anon;
grant execute on function public.bpos_admin_businesses() to authenticated;
grant execute on function public.bpos_admin_update_business(uuid, text, text, timestamptz, timestamptz, int, numeric) to authenticated;
