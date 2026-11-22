-- =============================================================
-- B-POS · Bridge: DiDi reinicia sus números a las 00:00
--
-- Antes, si llegaba el DiDi #1 a las 4 pm y después de medianoche llegaba
-- otro #1 (el turno seguía abierto), el Agent lo rechazaba como duplicado
-- y había que borrar el historial.
--
-- Ahora (misma regla que lib/bridge/order-identity.ts):
--  - DiDi: el mismo número el mismo día (hora de México) es el mismo pedido.
--    Pasando las 00:00 es otro, salvo que llegue a menos de 30 minutos con
--    el mismo total o los mismos productos (reimpresión).
--  - Uber, Rappi y otras: el mismo código en menos de 12 horas es el mismo.
--  - El pedido que repite número se guarda aparte con la llave
--    "plataforma|NÚMERO|AAAAMMDDHHmm" (y bridgeKey en sus datos): ya no se
--    borra el anterior, así queda el historial de turnos anteriores.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede correr más de una vez.
-- =============================================================

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
  v_base      text;
  v_key       text;
  v_prev      jsonb;
  v_prev_at   timestamptz;
  v_same      boolean;
  v_inserted  int;
begin
  if v_platform = '' or v_order_id = '' then
    raise exception 'Faltan platform u orderId';
  end if;
  v_base := v_platform || '|' || v_order_id;

  -- El último pedido con ese número (de cualquier día)
  select data, received_at into v_prev, v_prev_at
    from bpos_bridge_orders
   where branch_id = v_agent.branch_id
     and (order_key = v_base or left(order_key, length(v_base) + 1) = v_base || '|')
   order by received_at desc
   limit 1;

  if v_prev_at is null then
    v_key := v_base;
  else
    if v_platform like '%didi%' then
      v_same := (v_prev_at at time zone 'America/Mexico_City')::date = (now() at time zone 'America/Mexico_City')::date
        or (now() - v_prev_at < interval '30 minutes' and (
              (jsonb_typeof(v_prev->'total') = 'number' and jsonb_typeof(p_order->'total') = 'number'
                and (v_prev->>'total')::numeric > 0
                and abs((v_prev->>'total')::numeric - (p_order->>'total')::numeric) < 0.01)
              or (v_prev->'items') is not distinct from (p_order->'items')
            ));
    else
      v_same := now() - v_prev_at < interval '12 hours';
    end if;
    if v_same then
      return json_build_object('duplicate', true);
    end if;
    v_key := v_base || '|' || to_char(now() at time zone 'America/Mexico_City', 'YYYYMMDDHH24MI');
  end if;

  insert into bpos_bridge_orders (business_id, branch_id, order_key, data, status)
  values (
    v_agent.business_id,
    v_agent.branch_id,
    v_key,
    p_order || jsonb_build_object(
      'id', coalesce(p_order->'id', to_jsonb((extract(epoch from now()) * 1000)::bigint)),
      'platform', v_platform,
      'orderId', v_order_id,
      'bridgeReceivedAt', v_now,
      'status', 'Recibido'
    ) || case when v_key = v_base then '{}'::jsonb else jsonb_build_object('bridgeKey', v_key) end,
    'Recibido'
  )
  on conflict (branch_id, order_key) do nothing;
  get diagnostics v_inserted = row_count;
  return json_build_object('duplicate', v_inserted = 0);
end;
$$;
revoke all on function public.bpos_agent_submit_order(text, jsonb) from public;
grant execute on function public.bpos_agent_submit_order(text, jsonb) to anon, authenticated;
