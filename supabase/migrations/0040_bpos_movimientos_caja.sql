-- 0040 · Movimientos de caja en la nube (para FinancIA y reportes).
-- Una fila por movimiento (Gasto, Retiro, Retiro dueño, Ingreso extra), tanto
-- de los cortes cerrados (bpos_shift_history) como del turno abierto
-- (bpos_active_shift, que bpos_elementos no incluye porque es un objeto).
-- Mismas reglas que las vistas de 0003: security_invoker, cada quien ve solo
-- los negocios donde es miembro. Se puede correr más de una vez.

create or replace view public.bpos_movimientos_caja
with (security_invoker = on) as
-- cortes cerrados
select e.business_id,
       e.branch_id,
       b.name                                                          as sucursal,
       coalesce(e.item ->> 'shiftSessionId', e.item ->> 'sessionId', e.record_id) as turno_id,
       e.item ->> 'folio'                                              as folio,
       'cerrado'::text                                                 as estado_turno,
       (e.item ? 'voided')                                             as anulado,
       m.item ->> 'id'                                                 as movimiento_id,
       coalesce(m.item ->> 'type', '')                                 as tipo,
       coalesce(public.bpos_num(m.item ->> 'amount'), 0)               as monto,
       coalesce(m.item ->> 'reason', '')                               as motivo,
       public.bpos_ts(m.item ->> 'createdAt')                          as fecha,
       coalesce(m.item ->> 'userName', '')                             as usuario
from public.bpos_elementos e
left join public.branches b on b.id = e.branch_id
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(e.item -> 'movements') = 'array' then e.item -> 'movements' else '[]'::jsonb end
) as m(item)
where e.collection = 'bpos_shift_history'
  and jsonb_typeof(m.item) = 'object'
union all
-- turno abierto
select r.business_id,
       public.branch_uuid(r.scope),
       b.name,
       r.data ->> 'sessionId',
       null,
       'abierto'::text,
       false,
       m.item ->> 'id',
       coalesce(m.item ->> 'type', ''),
       coalesce(public.bpos_num(m.item ->> 'amount'), 0),
       coalesce(m.item ->> 'reason', ''),
       public.bpos_ts(m.item ->> 'createdAt'),
       coalesce(m.item ->> 'userName', '')
from public.sync_records r
left join public.branches b on b.id = public.branch_uuid(r.scope)
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(r.data -> 'movements') = 'array' then r.data -> 'movements' else '[]'::jsonb end
) as m(item)
where r.collection = 'bpos_active_shift'
  and r.record_id = '__doc__'
  and not r.deleted
  and jsonb_typeof(r.data) = 'object'
  and jsonb_typeof(m.item) = 'object';

revoke all on public.bpos_movimientos_caja from anon;
grant select on public.bpos_movimientos_caja to authenticated;
