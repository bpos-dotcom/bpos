-- =============================================================
-- B-POS · Kiosco: el Agent del kiosco también imprime comandas si es el
-- único de la sucursal
--
-- Caso real: el kiosco corre en la misma computadora que el POS. Con 0020,
-- al marcar ese Agent como "del kiosco" dejaba de tomar las comandas de
-- cocina y nadie las imprimía. Regla nueva:
--   · Un Agent de pantalla siempre toma lo dirigido a él (ticket del kiosco).
--   · Además toma los trabajos normales (comandas, ticket de caja) cuando no
--     hay otro Agent de caja en línea en la sucursal (visto en los últimos
--     30 s). Si lo hay, se los deja a ese.
--   · Sus impresoras: las de Configuración → Impresoras de la sucursal, con
--     "Caja" cambiada por la impresora de la pantalla (si tiene una).
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede correr más de una vez.
-- =============================================================

create or replace function public.bpos_agent_poll(p_token text, p_version text default null, p_printers jsonb default null)
returns json
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_agent   bpos_agents := public.bpos_agent_by_token(p_token);
  v_kiosk   bpos_kiosks;
  v_jobs    json;
  v_config  jsonb;
  v_general boolean := true;   -- ¿toma también los trabajos no dirigidos?
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

  -- ¿Este Agent es el de una pantalla de kiosco?
  if v_agent.kiosk_id is not null then
    select * into v_kiosk from bpos_kiosks where id = v_agent.kiosk_id and revoked_at is null;
  end if;
  if v_kiosk.id is not null then
    -- Solo deja las comandas a otro si hay un Agent de caja en línea
    v_general := not exists (
      select 1 from bpos_agents o
      where o.branch_id = v_agent.branch_id and o.id <> v_agent.id and o.revoked_at is null
        and o.kiosk_id is null and o.last_seen_at > now() - interval '30 seconds'
    );
  end if;

  with picked as (
    select id from bpos_agent_jobs
    where branch_id = v_agent.branch_id and status = 'pending'
      and (target_agent = v_agent.id or (target_agent is null and v_general))
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

  -- Qué impresora tiene cada estación (Configuración → Impresoras, sincronizado)
  select data into v_config from sync_records
    where business_id = v_agent.business_id and scope = v_agent.branch_id::text
      and collection = 'bpos_station_printers' and record_id = '__doc__' and not deleted;
  if v_kiosk.id is not null then
    -- La impresora de la pantalla es su "Caja" (ahí sale el ticket del cliente del kiosco)
    v_config := coalesce(v_config, '{}'::jsonb)
      || case when v_kiosk.printer <> '' then jsonb_build_object('Caja', v_kiosk.printer, 'paperWidthMm', v_kiosk.paper_mm) else '{}'::jsonb end;
  end if;

  return json_build_object(
    'business_name', (select name from businesses where id = v_agent.business_id),
    'branch_name', (select name from branches where id = v_agent.branch_id),
    'station_printers', v_config,
    'jobs', v_jobs
  );
end;
$$;
