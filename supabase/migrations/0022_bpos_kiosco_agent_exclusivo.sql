-- =============================================================
-- B-POS · Kiosco: Agent exclusivo del kiosco, vinculado desde Menú digital
--
-- Se regresa a la regla de 0020: el Agent de una pantalla SOLO imprime el
-- ticket del kiosco (trabajos dirigidos a él) y nunca toma comandas. Para
-- que no se vuelva a marcar por error la computadora de la caja, el Agent
-- del kiosco ya no se elige entre los de la sucursal: se vincula con su
-- propio código generado en Configuración → Menú digital → Pantalla en el
-- local (bpos_agent_codes.kiosk_id). Ese código deja al Agent ligado a la
-- pantalla desde el primer momento.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede correr más de una vez.
-- =============================================================

alter table public.bpos_agent_codes
  add column if not exists kiosk_id uuid references public.bpos_kiosks (id) on delete cascade;

-- Los Agents que se marcaron como "del kiosco" eligiéndolos de la lista
-- vuelven a ser Agents de caja (el del kiosco se vincula con su código)
update public.bpos_agents set kiosk_id = null where kiosk_id is not null;
update public.bpos_kiosks set printer = '' where printer <> '';

-- El Agent canjea el código por su llave; con código de pantalla queda ligado a ella
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
  if v_code.kiosk_id is not null then
    -- Una pantalla tiene un solo Agent: el anterior queda desvinculado
    update bpos_agents set revoked_at = now() where kiosk_id = v_code.kiosk_id and revoked_at is null;
  end if;
  insert into bpos_agents (business_id, branch_id, name, token_hash, version, last_seen_at, kiosk_id)
  values (v_code.business_id, v_code.branch_id, left(coalesce(p_name, ''), 80),
          encode(digest(v_token, 'sha256'), 'hex'), left(coalesce(p_version, ''), 30), now(), v_code.kiosk_id)
  returning id into v_agent;
  return json_build_object(
    'token', v_token,
    'agent_id', v_agent,
    'business_name', (select name from businesses where id = v_code.business_id),
    'branch_name', (select name from branches where id = v_code.branch_id)
  );
end;
$$;

-- Regla de 0020: Agent de pantalla = solo lo dirigido a él; Agent de caja = todo lo demás
create or replace function public.bpos_agent_poll(p_token text, p_version text default null, p_printers jsonb default null)
returns json
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_agent  bpos_agents := public.bpos_agent_by_token(p_token);
  v_kiosk  bpos_kiosks;
  v_jobs   json;
  v_config jsonb;
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

  if v_agent.kiosk_id is not null then
    select * into v_kiosk from bpos_kiosks where id = v_agent.kiosk_id and revoked_at is null;
  end if;

  with picked as (
    select id from bpos_agent_jobs
    where branch_id = v_agent.branch_id and status = 'pending'
      and (case when v_agent.kiosk_id is not null then target_agent = v_agent.id else target_agent is null end)
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

  if v_agent.kiosk_id is not null then
    -- La impresora de la pantalla es su "Caja" (ahí sale el ticket del cliente)
    v_config := jsonb_build_object('Caja', coalesce(v_kiosk.printer, ''), 'paperWidthMm', coalesce(v_kiosk.paper_mm, 80), 'printMode', 'escpos');
  else
    -- Qué impresora tiene cada estación (Configuración → Impresoras, sincronizado)
    select data into v_config from sync_records
      where business_id = v_agent.business_id and scope = v_agent.branch_id::text
        and collection = 'bpos_station_printers' and record_id = '__doc__' and not deleted;
  end if;

  return json_build_object(
    'business_name', (select name from businesses where id = v_agent.business_id),
    'branch_name', (select name from branches where id = v_agent.branch_id),
    'station_printers', v_config,
    'jobs', v_jobs
  );
end;
$$;
