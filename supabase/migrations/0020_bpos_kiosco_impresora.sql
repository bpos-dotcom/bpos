-- =============================================================
-- B-POS · Kiosco: ticket del cliente en una impresora del kiosco
--
-- La computadora del kiosco tiene su propio B-POS Agent (se vincula igual
-- que el de la caja, en Configuración → Sistema). En Configuración → Menú
-- digital → Pantalla en el local se elige qué Agent y qué impresora le
-- tocan a cada pantalla. Al aprobarse el pago, el servidor deja un trabajo
-- de impresión dirigido SOLO a ese Agent.
--
-- 1. bpos_agents.kiosk_id: el Agent que es de una pantalla. Ese Agent solo
--    toma trabajos dirigidos a él (no se lleva comandas de la cocina) y su
--    impresora de "Caja" es la de la pantalla.
-- 2. bpos_kiosks.printer / paper_mm: impresora del ticket y ancho del papel.
-- 3. bpos_agent_jobs.target_agent: trabajo para un Agent en particular.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede correr más de una vez.
-- =============================================================

alter table public.bpos_agents
  add column if not exists kiosk_id uuid references public.bpos_kiosks (id) on delete set null;

alter table public.bpos_kiosks
  add column if not exists printer  text not null default '',
  add column if not exists paper_mm int  not null default 80;

alter table public.bpos_agent_jobs
  add column if not exists target_agent uuid references public.bpos_agents (id) on delete cascade;

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

  -- ¿Este Agent es el de una pantalla de kiosco?
  if v_agent.kiosk_id is not null then
    select * into v_kiosk from bpos_kiosks where id = v_agent.kiosk_id and revoked_at is null;
  end if;

  with picked as (
    select id from bpos_agent_jobs
    where branch_id = v_agent.branch_id and status = 'pending'
      and (
        -- Agent del kiosco: solo lo que es para él. Agent de la caja: todo lo demás
        case when v_kiosk.id is not null then target_agent = v_agent.id else target_agent is null end
      )
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

  if v_kiosk.id is not null then
    -- La impresora de la pantalla es su "Caja" (el ticket del cliente sale ahí)
    v_config := jsonb_build_object('Caja', v_kiosk.printer, 'paperWidthMm', v_kiosk.paper_mm, 'printMode', 'escpos');
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
