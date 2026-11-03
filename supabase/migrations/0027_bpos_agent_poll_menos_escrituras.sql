-- =============================================================
-- Menos escrituras en disco (aviso de Supabase: Disk IO Budget).
-- bpos_agent_poll corre cada 2 s por cada Agent; el "sigo vivo"
-- (last_seen_at) ahora se escribe cada 15 s como máximo. B-POS da
-- al Agent por desconectado hasta los 30 s (lib/agent/client.ts).
-- Mismo cuerpo que 0022 salvo ese update.
-- =============================================================

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
  -- "Sigo vivo": se escribe cada 15 s como máximo (antes en cada vuelta de 2 s, y eso gastaba
  -- el presupuesto de disco del servidor); la versión o las impresoras, en cuanto cambian
  if p_printers is not null
     or v_agent.last_seen_at is null
     or v_agent.last_seen_at < now() - interval '15 seconds'
     or (p_version is not null and v_agent.version is distinct from left(p_version, 30)) then
    update bpos_agents set
      last_seen_at = now(),
      version = coalesce(left(p_version, 30), version),
      printers = coalesce(p_printers, printers)
    where id = v_agent.id;
  end if;

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
