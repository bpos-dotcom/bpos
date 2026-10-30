-- =====================================================================
-- B-POS · 2.0 · B-POS en la nube + B-POS Agent
-- ---------------------------------------------------------------------
-- B-POS se usa desde la web (bpos.com.mx). En la computadora del local
-- solo se instala B-POS Agent: lee los tickets de Rappi/Uber/DiDi y los
-- sube a la nube, e imprime lo que mandan las pantallas.
--
-- 1. bpos_agents: cada Agent vinculado a una sucursal (con una llave
--    propia; aquí solo se guarda su huella sha256).
-- 2. bpos_agent_codes: códigos de 8 letras para vincular un Agent desde
--    Configuración → Sistema (duran 15 minutos y se usan una vez).
-- 3. bpos_agent_jobs: cola de impresión. Cualquier pantalla del negocio
--    (caja, tablet, celular) deja un trabajo y el Agent de la sucursal lo
--    imprime y deja el resultado.
-- 4. bpos_bridge_orders / bpos_bridge_aliases: pedidos de delivery y
--    equivalencias del Bridge (antes vivían en un archivo de la PC).
--
-- El Agent no es una cuenta de Supabase: entra con la llave pública y
-- solo puede usar las funciones bpos_agent_* (que revisan su llave).
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede correr más de una vez.
-- =====================================================================

create table if not exists public.bpos_agents (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  branch_id     uuid not null references public.branches (id) on delete cascade,
  name          text not null default '',
  token_hash    text not null unique,
  version       text not null default '',
  printers      jsonb not null default '[]'::jsonb,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz
);
create index if not exists bpos_agents_branch_idx on public.bpos_agents (branch_id);

create table if not exists public.bpos_agent_codes (
  code         text primary key,
  business_id  uuid not null references public.businesses (id) on delete cascade,
  branch_id    uuid not null references public.branches (id) on delete cascade,
  created_by   uuid,
  expires_at   timestamptz not null,
  used_at      timestamptz
);

create table if not exists public.bpos_agent_jobs (
  id           bigint generated always as identity primary key,
  business_id  uuid not null references public.businesses (id) on delete cascade,
  branch_id    uuid not null references public.branches (id) on delete cascade,
  kind         text not null check (kind in ('print-tickets', 'print-original', 'station-printers', 'print')),
  payload      jsonb not null default '{}'::jsonb,
  status       text not null default 'pending' check (status in ('pending', 'taken', 'done', 'error')),
  result       jsonb,
  agent_id     uuid references public.bpos_agents (id) on delete set null,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  taken_at     timestamptz,
  done_at      timestamptz
);
create index if not exists bpos_agent_jobs_queue_idx on public.bpos_agent_jobs (branch_id, status, created_at);

create table if not exists public.bpos_bridge_orders (
  business_id  uuid not null references public.businesses (id) on delete cascade,
  branch_id    uuid not null references public.branches (id) on delete cascade,
  order_key    text not null,             -- plataforma|PEDIDO
  data         jsonb not null,
  status       text not null default 'Recibido',
  received_at  timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (branch_id, order_key)
);
create index if not exists bpos_bridge_orders_recent_idx on public.bpos_bridge_orders (branch_id, received_at desc);

create table if not exists public.bpos_bridge_aliases (
  business_id  uuid not null references public.businesses (id) on delete cascade,
  id           text not null,
  data         jsonb not null,
  updated_at   timestamptz not null default now(),
  primary key (business_id, id)
);

-- ------------------------------------------------------------- permisos

alter table public.bpos_agents enable row level security;
alter table public.bpos_agent_codes enable row level security;
alter table public.bpos_agent_jobs enable row level security;
alter table public.bpos_bridge_orders enable row level security;
alter table public.bpos_bridge_aliases enable row level security;

-- Agents: el negocio los ve, les cambia el nombre y los desvincula
drop policy if exists bpos_agents_member_select on public.bpos_agents;
create policy bpos_agents_member_select on public.bpos_agents
  for select to authenticated using (public.is_member(business_id));
drop policy if exists bpos_agents_member_update on public.bpos_agents;
create policy bpos_agents_member_update on public.bpos_agents
  for update to authenticated using (public.is_member(business_id)) with check (public.is_member(business_id));
drop policy if exists bpos_agents_member_delete on public.bpos_agents;
create policy bpos_agents_member_delete on public.bpos_agents
  for delete to authenticated using (public.is_member(business_id));
revoke all on public.bpos_agents from anon, authenticated;
grant select, delete on public.bpos_agents to authenticated;
grant update (name, revoked_at) on public.bpos_agents to authenticated;

-- Códigos: solo por las funciones
revoke all on public.bpos_agent_codes from anon, authenticated;

-- Trabajos: las pantallas los crean y leen su resultado; el Agent, por funciones
drop policy if exists bpos_agent_jobs_member_select on public.bpos_agent_jobs;
create policy bpos_agent_jobs_member_select on public.bpos_agent_jobs
  for select to authenticated using (public.is_member(business_id));
drop policy if exists bpos_agent_jobs_member_insert on public.bpos_agent_jobs;
create policy bpos_agent_jobs_member_insert on public.bpos_agent_jobs
  for insert to authenticated
  with check (
    public.is_member(business_id)
    and public.branch_business(branch_id) = business_id
    and status = 'pending'
  );
revoke all on public.bpos_agent_jobs from anon, authenticated;
grant select on public.bpos_agent_jobs to authenticated;
grant insert (business_id, branch_id, kind, payload) on public.bpos_agent_jobs to authenticated;

drop policy if exists bpos_bridge_orders_member_all on public.bpos_bridge_orders;
create policy bpos_bridge_orders_member_all on public.bpos_bridge_orders
  for all to authenticated
  using (public.is_member(business_id))
  with check (public.is_member(business_id) and public.branch_business(branch_id) = business_id);
revoke all on public.bpos_bridge_orders from anon;
grant select, insert, update, delete on public.bpos_bridge_orders to authenticated;

drop policy if exists bpos_bridge_aliases_member_all on public.bpos_bridge_aliases;
create policy bpos_bridge_aliases_member_all on public.bpos_bridge_aliases
  for all to authenticated
  using (public.is_member(business_id)) with check (public.is_member(business_id));
revoke all on public.bpos_bridge_aliases from anon;
grant select, insert, update, delete on public.bpos_bridge_aliases to authenticated;

-- ------------------------------------------------------------- funciones

-- Código para vincular un Agent a la sucursal (lo pide la pantalla Sistema)
create or replace function public.bpos_agent_new_code(p_branch_id uuid)
returns json
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_business  uuid := public.branch_business(p_branch_id);
  v_alphabet  text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes     bytea;
  v_code      text;
  v_expires   timestamptz := now() + interval '15 minutes';
begin
  if v_business is null or not public.is_member(v_business) then
    raise exception 'Sucursal no encontrada';
  end if;
  delete from bpos_agent_codes where expires_at < now() - interval '1 day';
  loop
    v_bytes := gen_random_bytes(8);
    v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % length(v_alphabet)), 1);
    end loop;
    exit when not exists (select 1 from bpos_agent_codes where code = v_code);
  end loop;
  insert into bpos_agent_codes (code, business_id, branch_id, created_by, expires_at)
  values (v_code, v_business, p_branch_id, auth.uid(), v_expires);
  return json_build_object('code', v_code, 'expires_at', v_expires);
end;
$$;

-- El Agent canjea el código por su llave (solo se muestra esta vez)
create or replace function public.bpos_agent_pair(p_code text, p_name text default '', p_version text default '')
returns json
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_code   bpos_agent_codes;
  v_token  text := encode(gen_random_bytes(32), 'hex');
  v_agent  uuid;
begin
  select * into v_code from bpos_agent_codes
  where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
  for update;
  if v_code.code is null or v_code.used_at is not null or v_code.expires_at < now() then
    raise exception 'Código inválido o vencido';
  end if;
  update bpos_agent_codes set used_at = now() where code = v_code.code;
  insert into bpos_agents (business_id, branch_id, name, token_hash, version, last_seen_at)
  values (v_code.business_id, v_code.branch_id, left(coalesce(p_name, ''), 80),
          encode(digest(v_token, 'sha256'), 'hex'), left(coalesce(p_version, ''), 30), now())
  returning id into v_agent;
  return json_build_object(
    'token', v_token,
    'agent_id', v_agent,
    'business_name', (select name from businesses where id = v_code.business_id),
    'branch_name', (select name from branches where id = v_code.branch_id)
  );
end;
$$;

-- Agent dueño de una llave (no se expone)
create or replace function public.bpos_agent_by_token(p_token text)
returns bpos_agents
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_agent bpos_agents;
begin
  select * into v_agent from bpos_agents
  where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and revoked_at is null;
  if v_agent.id is null then
    raise exception 'Agent desvinculado' using errcode = '28000';
  end if;
  return v_agent;
end;
$$;
revoke all on function public.bpos_agent_by_token(text) from public, anon, authenticated;

-- Cada pocos segundos: "sigo vivo", qué impresoras hay y qué hay que imprimir
create or replace function public.bpos_agent_poll(p_token text, p_version text default null, p_printers jsonb default null)
returns json
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_agent  bpos_agents := public.bpos_agent_by_token(p_token);
  v_jobs   json;
begin
  update bpos_agents set
    last_seen_at = now(),
    version = coalesce(left(p_version, 30), version),
    printers = coalesce(p_printers, printers)
  where id = v_agent.id;

  -- Lo viejo ya no se imprime (ej. el Agent estuvo apagado una hora)
  update bpos_agent_jobs set status = 'error', result = '{"error":"El Agent no lo recibió a tiempo."}'::jsonb, done_at = now()
  where branch_id = v_agent.branch_id and status = 'pending' and created_at < now() - interval '10 minutes';
  if random() < 0.01 then
    delete from bpos_agent_jobs where branch_id = v_agent.branch_id and created_at < now() - interval '3 days';
  end if;

  with picked as (
    select id from bpos_agent_jobs
    where branch_id = v_agent.branch_id and status = 'pending'
    order by created_at
    limit 10
    for update skip locked
  ), taken as (
    update bpos_agent_jobs j set status = 'taken', agent_id = v_agent.id, taken_at = now()
    from picked where j.id = picked.id
    returning j.id, j.kind, j.payload, j.created_at
  )
  select coalesce(json_agg(json_build_object('id', id, 'kind', kind, 'payload', payload) order by created_at), '[]'::json)
  into v_jobs
  from taken;

  return json_build_object(
    'business_name', (select name from businesses where id = v_agent.business_id),
    'branch_name', (select name from branches where id = v_agent.branch_id),
    -- Qué impresora tiene cada estación (Configuración → Impresoras, sincronizado)
    'station_printers', (select data from sync_records
      where business_id = v_agent.business_id and scope = v_agent.branch_id::text
        and collection = 'bpos_station_printers' and record_id = '__doc__' and not deleted),
    'jobs', v_jobs
  );
end;
$$;

create or replace function public.bpos_agent_finish(p_token text, p_job_id bigint, p_ok boolean, p_result jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_agent bpos_agents := public.bpos_agent_by_token(p_token);
begin
  update bpos_agent_jobs set
    status = case when p_ok then 'done' else 'error' end,
    result = p_result,
    done_at = now()
  where id = p_job_id and branch_id = v_agent.branch_id;
end;
$$;

-- Pedido leído de un ticket de Rappi/Uber/DiDi (repetido: no se duplica)
create or replace function public.bpos_agent_submit_order(p_token text, p_order jsonb)
returns json
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_agent     bpos_agents := public.bpos_agent_by_token(p_token);
  v_platform  text := lower(trim(coalesce(p_order->>'platform', '')));
  v_order_id  text := upper(trim(coalesce(p_order->>'orderId', '')));
  v_now       text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_inserted  int;
begin
  if v_platform = '' or v_order_id = '' then
    raise exception 'Faltan platform u orderId';
  end if;
  insert into bpos_bridge_orders (business_id, branch_id, order_key, data, status)
  values (
    v_agent.business_id,
    v_agent.branch_id,
    v_platform || '|' || v_order_id,
    p_order || jsonb_build_object(
      'id', coalesce(p_order->'id', to_jsonb((extract(epoch from now()) * 1000)::bigint)),
      'platform', v_platform,
      'orderId', v_order_id,
      'bridgeReceivedAt', v_now,
      'status', 'Recibido'
    ),
    'Recibido'
  )
  on conflict (branch_id, order_key) do nothing;
  get diagnostics v_inserted = row_count;
  return json_build_object('duplicate', v_inserted = 0);
end;
$$;

-- Al pasar de B-POS 1.x: sube las equivalencias y pedidos pendientes que estaban en la PC
create or replace function public.bpos_agent_import(p_token text, p_aliases jsonb, p_orders jsonb)
returns json
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_agent    bpos_agents := public.bpos_agent_by_token(p_token);
  v_aliases  int := 0;
  v_orders   int := 0;
begin
  insert into bpos_bridge_aliases (business_id, id, data)
  select v_agent.business_id, a->>'id', a
  from jsonb_array_elements(case when jsonb_typeof(p_aliases) = 'array' then p_aliases else '[]'::jsonb end) a
  where coalesce(a->>'id', '') <> ''
  on conflict (business_id, id) do nothing;
  get diagnostics v_aliases = row_count;

  insert into bpos_bridge_orders (business_id, branch_id, order_key, data, status)
  select v_agent.business_id, v_agent.branch_id,
         lower(trim(o->>'platform')) || '|' || upper(trim(o->>'orderId')),
         o, coalesce(o->>'status', 'Recibido')
  from jsonb_array_elements(case when jsonb_typeof(p_orders) = 'array' then p_orders else '[]'::jsonb end) o
  where coalesce(trim(o->>'platform'), '') <> '' and coalesce(trim(o->>'orderId'), '') <> ''
  on conflict (branch_id, order_key) do nothing;
  get diagnostics v_orders = row_count;

  return json_build_object('aliases', v_aliases, 'orders', v_orders);
end;
$$;

revoke all on function public.bpos_agent_new_code(uuid) from public, anon;
grant execute on function public.bpos_agent_new_code(uuid) to authenticated;
revoke all on function public.bpos_agent_pair(text, text, text) from public;
grant execute on function public.bpos_agent_pair(text, text, text) to anon, authenticated;
revoke all on function public.bpos_agent_poll(text, text, jsonb) from public;
grant execute on function public.bpos_agent_poll(text, text, jsonb) to anon, authenticated;
revoke all on function public.bpos_agent_finish(text, bigint, boolean, jsonb) from public;
grant execute on function public.bpos_agent_finish(text, bigint, boolean, jsonb) to anon, authenticated;
revoke all on function public.bpos_agent_submit_order(text, jsonb) from public;
grant execute on function public.bpos_agent_submit_order(text, jsonb) to anon, authenticated;
revoke all on function public.bpos_agent_import(text, jsonb, jsonb) from public;
grant execute on function public.bpos_agent_import(text, jsonb, jsonb) to anon, authenticated;

-- ------------------------------------------------------------- respaldos
-- Copia diaria del negocio (antes se guardaba en la PC de la caja).
-- Se conservan los últimos 7 días; además se puede descargar cuando sea.
create table if not exists public.bpos_backups (
  business_id  uuid not null references public.businesses (id) on delete cascade,
  day          date not null,
  data         jsonb not null,
  size         int not null default 0,
  created_at   timestamptz not null default now(),
  primary key (business_id, day)
);
alter table public.bpos_backups enable row level security;
drop policy if exists bpos_backups_member_all on public.bpos_backups;
create policy bpos_backups_member_all on public.bpos_backups
  for all to authenticated
  using (public.is_member(business_id)) with check (public.is_member(business_id));
revoke all on public.bpos_backups from anon;
grant select, insert, update, delete on public.bpos_backups to authenticated;
