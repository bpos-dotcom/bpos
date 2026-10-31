-- =============================================================
-- B-POS · Club de clientes (fidelidad)
--
-- Cada restaurante configura su club en B-POS (Configuración → Club, se
-- guarda en sync_records: bpos_loyalty, scope 'business'):
--   kind 'puntos'   → 1 punto por cada pesosPerPoint pesos; canje por premios
--   kind 'sellos'   → 1 sello por compra (desde stampMinPurchase); a los
--                     stampsGoal sellos, el premio stampReward
--   kind 'cashback' → cashbackPercent % de cada compra como saldo
-- y un regalo de bienvenida (welcomeAmount en su unidad).
--
-- El cliente se une desde bpos.com.mx/fidelidad/<liga> con su cuenta del
-- menú digital (lo hace el servidor de B-POS). La caja suma y canjea con
-- estas funciones (solo miembros del negocio).
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede correr más de una vez.
-- =============================================================

create table if not exists public.bpos_loyalty_members (
  account_id   uuid primary key references public.bpos_customer_accounts (id) on delete cascade,
  business_id  uuid not null references public.businesses (id) on delete cascade,
  code         text not null,                         -- va en el QR de su tarjeta
  points       numeric not null default 0,
  stamps       int not null default 0,
  cashback     numeric not null default 0,            -- saldo en pesos
  wallet_saved boolean not null default false,
  joined_at    timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, code)
);

create table if not exists public.bpos_loyalty_movements (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  account_id  uuid not null references public.bpos_customer_accounts (id) on delete cascade,
  kind        text not null check (kind in ('bienvenida', 'compra', 'canje', 'ajuste')),
  points      numeric not null default 0,
  stamps      int not null default 0,
  cashback    numeric not null default 0,
  amount      numeric not null default 0,               -- compra que lo generó
  ref         text not null default '',                 -- venta o pedido (evita sumar dos veces)
  note        text not null default '',
  created_by  text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists bpos_loyalty_movements_account_idx on public.bpos_loyalty_movements (account_id, created_at desc);
create unique index if not exists bpos_loyalty_movements_ref_idx on public.bpos_loyalty_movements (account_id, kind, ref) where ref <> '';

alter table public.bpos_loyalty_members enable row level security;
alter table public.bpos_loyalty_movements enable row level security;

do $pol$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'bpos_loyalty_members' and policyname = 'bpos_loyalty_members_member') then
    create policy bpos_loyalty_members_member on public.bpos_loyalty_members
      for select to authenticated using (public.is_member(business_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'bpos_loyalty_movements' and policyname = 'bpos_loyalty_movements_member') then
    create policy bpos_loyalty_movements_member on public.bpos_loyalty_movements
      for select to authenticated using (public.is_member(business_id));
  end if;
end
$pol$;

-- Configuración del club del negocio
create or replace function public.bpos_loyalty_config(p_business uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select data from sync_records
                    where business_id = p_business and scope = 'business'
                      and collection = 'bpos_loyalty' and record_id = '__doc__' and not deleted), '{}'::jsonb);
$$;

-- La caja busca al socio por teléfono o por el código de su tarjeta
create or replace function public.bpos_loyalty_find(p_query text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(json_build_object(
           'account_id', a.id,
           'name', a.name,
           'phone', a.phone,
           'code', m.code,
           'member', m.account_id is not null,
           'points', coalesce(m.points, 0),
           'stamps', coalesce(m.stamps, 0),
           'cashback', coalesce(m.cashback, 0)
         ) order by a.name), '[]'::json)
    from bpos_customer_accounts a
    left join bpos_loyalty_members m on m.account_id = a.id
   where public.is_member(a.business_id)
     and a.email_verified_at is not null
     and (
       (length(regexp_replace(coalesce(p_query, ''), '\D', '', 'g')) >= 10
         and a.phone = right(regexp_replace(p_query, '\D', '', 'g'), 10))
       or upper(trim(coalesce(p_query, ''))) = m.code
     );
$$;

-- Suma de una compra según el tipo de club (una sola vez por venta)
create or replace function public.bpos_loyalty_earn(p_account uuid, p_amount numeric, p_ref text, p_by text default '')
returns json
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_m      bpos_loyalty_members;
  v_cfg    jsonb;
  v_points numeric := 0;
  v_stamps int := 0;
  v_cash   numeric := 0;
  v_amount numeric := greatest(0, coalesce(p_amount, 0));
begin
  select * into v_m from bpos_loyalty_members where account_id = p_account;
  if not found then
    return json_build_object('member', false);
  end if;
  if not public.is_member(v_m.business_id) then
    raise exception 'Sin permiso.';
  end if;
  v_cfg := public.bpos_loyalty_config(v_m.business_id);
  if coalesce((v_cfg->>'enabled')::boolean, false) is false then
    return json_build_object('member', true, 'enabled', false);
  end if;
  if coalesce(p_ref, '') <> '' and exists (select 1 from bpos_loyalty_movements where account_id = p_account and kind = 'compra' and ref = p_ref) then
    return json_build_object('member', true, 'repeated', true);
  end if;

  if v_cfg->>'kind' = 'sellos' then
    if v_amount >= coalesce((v_cfg->>'stampMinPurchase')::numeric, 0) and v_amount > 0 then
      v_stamps := 1;
    end if;
  elsif v_cfg->>'kind' = 'cashback' then
    v_cash := round(v_amount * coalesce((v_cfg->>'cashbackPercent')::numeric, 0) / 100, 2);
  else
    v_points := floor(v_amount / greatest(coalesce((v_cfg->>'pesosPerPoint')::numeric, 10), 1));
  end if;

  insert into bpos_loyalty_movements (business_id, account_id, kind, points, stamps, cashback, amount, ref, created_by)
  values (v_m.business_id, p_account, 'compra', v_points, v_stamps, v_cash, v_amount, coalesce(p_ref, ''), left(coalesce(p_by, ''), 60));
  update bpos_loyalty_members
     set points = points + v_points, stamps = stamps + v_stamps, cashback = cashback + v_cash, updated_at = now()
   where account_id = p_account
  returning * into v_m;

  return json_build_object('member', true, 'points', v_m.points, 'stamps', v_m.stamps, 'cashback', v_m.cashback,
                           'earned', json_build_object('points', v_points, 'stamps', v_stamps, 'cashback', v_cash));
end;
$$;

-- Canje en la caja: puntos (premio), sellos (premio al completar) o saldo
create or replace function public.bpos_loyalty_redeem(p_account uuid, p_points numeric, p_stamps int, p_cashback numeric, p_note text, p_ref text default '', p_by text default '')
returns json
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_m bpos_loyalty_members;
  v_p numeric := greatest(0, coalesce(p_points, 0));
  v_s int := greatest(0, coalesce(p_stamps, 0));
  v_c numeric := round(greatest(0, coalesce(p_cashback, 0)), 2);
begin
  select * into v_m from bpos_loyalty_members where account_id = p_account for update;
  if not found or not public.is_member(v_m.business_id) then
    raise exception 'Socio no encontrado.';
  end if;
  if v_p > v_m.points or v_s > v_m.stamps or v_c > v_m.cashback then
    raise exception 'No le alcanza: tiene % puntos, % sellos y $% de saldo.', v_m.points, v_m.stamps, v_m.cashback;
  end if;
  if v_p = 0 and v_s = 0 and v_c = 0 then
    raise exception 'Nada que canjear.';
  end if;
  insert into bpos_loyalty_movements (business_id, account_id, kind, points, stamps, cashback, ref, note, created_by)
  values (v_m.business_id, p_account, 'canje', -v_p, -v_s, -v_c, coalesce(p_ref, ''), left(coalesce(p_note, ''), 120), left(coalesce(p_by, ''), 60));
  update bpos_loyalty_members
     set points = points - v_p, stamps = stamps - v_s, cashback = cashback - v_c, updated_at = now()
   where account_id = p_account
  returning * into v_m;
  return json_build_object('points', v_m.points, 'stamps', v_m.stamps, 'cashback', v_m.cashback);
end;
$$;

grant execute on function public.bpos_loyalty_find(text) to authenticated;
grant execute on function public.bpos_loyalty_earn(uuid, numeric, text, text) to authenticated;
grant execute on function public.bpos_loyalty_redeem(uuid, numeric, int, numeric, text, text, text) to authenticated;
