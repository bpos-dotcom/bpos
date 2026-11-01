-- B-POS Agent: con dos Agents vinculados a la misma sucursal (una computadora
-- vieja que se quedó vinculada), los trabajos de impresión se los llevaba el
-- que preguntara primero, y el viejo fallaba. Ahora un Agent no toma trabajos
-- si hay otro Agent conectado en su sucursal con una versión más nueva.

create or replace function public.bpos_agent_version_key(p_version text)
returns int[]
language sql
immutable
as $$
  select case
    when coalesce(p_version, '') ~ '^\d+(\.\d+)*$' then string_to_array(p_version, '.')::int[]
    else array[0]
  end;
$$;

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
  v_newer  boolean;
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

  -- ¿Hay otro Agent conectado (visto hace menos de 40 s) en la sucursal con versión más nueva? Entonces él imprime.
  select exists (
    select 1 from bpos_agents a
    where a.branch_id = v_agent.branch_id and a.id <> v_agent.id and a.revoked_at is null
      and a.last_seen_at > now() - interval '40 seconds'
      and public.bpos_agent_version_key(a.version) > public.bpos_agent_version_key(coalesce(left(p_version, 30), v_agent.version))
  ) into v_newer;

  if v_newer then
    v_jobs := '[]'::json;
  else
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
  end if;

  return json_build_object(
    'business_name', (select name from businesses where id = v_agent.business_id),
    'branch_name', (select name from branches where id = v_agent.branch_id),
    -- Qué impresora tiene cada estación (Configuración → Impresoras, sincronizado)
    'station_printers', (select data from sync_records
      where business_id = v_agent.business_id and scope = v_agent.branch_id::text
        and collection = 'bpos_station_printers' and record_id = '__doc__' and not deleted),
    'jobs', v_jobs,
    -- Para que el Agent viejo avise en su ventana que otro más nuevo está imprimiendo
    'standby', v_newer
  );
end;
$$;
