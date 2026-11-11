-- 0040 · Movimientos de caja en la nube (para FinancIA y reportes).
-- Una fila por movimiento (Gasto, Retiro, Retiro dueño, Ingreso extra), tanto
-- de los cortes cerrados (bpos_shift_history) como del turno abierto
-- (bpos_active_shift). Lee sync_records directo (no depende de las vistas de
-- 0003) con security_invoker: cada quien ve solo los negocios donde es
-- miembro. Se puede correr más de una vez.

create or replace view public.bpos_movimientos_caja
with (security_invoker = on) as
with turnos as (
  -- cortes cerrados: una fila por corte o, en datos viejos, un arreglo en '__doc__'
  select r.business_id, r.scope, r.record_id, r.data as turno, 'cerrado'::text as estado
  from public.sync_records r
  where r.collection = 'bpos_shift_history' and not r.deleted and jsonb_typeof(r.data) = 'object'
  union all
  select r.business_id, r.scope, r.record_id, x.item, 'cerrado'
  from public.sync_records r
  cross join lateral jsonb_array_elements(r.data) as x(item)
  where r.collection = 'bpos_shift_history' and not r.deleted and r.record_id = '__doc__'
    and jsonb_typeof(r.data) = 'array' and jsonb_typeof(x.item) = 'object'
  union all
  -- turno abierto
  select r.business_id, r.scope, r.record_id, r.data, 'abierto'
  from public.sync_records r
  where r.collection = 'bpos_active_shift' and not r.deleted and r.record_id = '__doc__' and jsonb_typeof(r.data) = 'object'
)
select t.business_id,
       b.id                                                                   as branch_id,
       b.name                                                                 as sucursal,
       coalesce(t.turno ->> 'shiftSessionId', t.turno ->> 'sessionId', t.record_id) as turno_id,
       t.turno ->> 'folio'                                                    as folio,
       t.estado                                                               as estado_turno,
       (t.turno ? 'voided')                                                   as anulado,
       m.item ->> 'id'                                                        as movimiento_id,
       coalesce(m.item ->> 'type', '')                                        as tipo,
       case when (m.item ->> 'amount') ~ '^-?[0-9]+(\.[0-9]+)?$' then (m.item ->> 'amount')::numeric else 0 end as monto,
       coalesce(m.item ->> 'reason', '')                                      as motivo,
       case when (m.item ->> 'createdAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then (m.item ->> 'createdAt')::timestamptz end as fecha,
       coalesce(m.item ->> 'userName', '')                                    as usuario
from turnos t
left join public.branches b on b.id::text = t.scope
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(t.turno -> 'movements') = 'array' then t.turno -> 'movements' else '[]'::jsonb end
) as m(item)
where jsonb_typeof(m.item) = 'object';

revoke all on public.bpos_movimientos_caja from anon;
grant select on public.bpos_movimientos_caja to authenticated;
