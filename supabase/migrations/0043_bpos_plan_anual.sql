-- =============================================================
-- B-POS · Plan anual (2 meses gratis)
-- businesses.billing_period: 'monthly' o 'annual'. Lo escribe el servidor
-- (service_role) al confirmar el pago en Mercado Pago; el dueño no puede
-- cambiarlo (se agrega al trigger businesses_protect_plan de 0006).
-- =============================================================

alter table public.businesses
  add column if not exists billing_period text not null default 'monthly';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'businesses_billing_period_check') then
    alter table public.businesses
      add constraint businesses_billing_period_check check (billing_period in ('monthly', 'annual'));
  end if;
end $$;

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
  new.billing_period := old.billing_period;
  return new;
end;
$$;
