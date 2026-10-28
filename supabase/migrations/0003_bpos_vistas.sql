-- =====================================================================
-- B-POS · Bloque 11 (parte 3) · Datos del negocio como tablas
-- ---------------------------------------------------------------------
-- B-POS guarda cada registro en sync_records como JSON (ver 0002).
-- Estas vistas lo muestran como tablas normales para consultarlo con SQL,
-- desde Supabase (Table Editor / SQL Editor), reportes o una API:
--
--   bpos_ventas            una fila por venta
--   bpos_ventas_partidas   una fila por producto vendido
--   bpos_productos         catálogo
--   bpos_insumos           insumos con existencia por sucursal
--   bpos_compras           una fila por compra
--   bpos_compras_partidas  una fila por insumo comprado
--   bpos_costos_insumos    historial de costo unitario
--   bpos_cortes_caja       turnos de caja cerrados
--
-- Son vistas (no copian datos): siempre están al día, no cambian cómo
-- sincroniza B-POS y respetan los permisos (cada cuenta solo ve su negocio).
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede correr más de una vez.
-- =====================================================================

-- Conversiones que no fallan con datos raros (regresan null)
create or replace function public.bpos_num(p text)
returns numeric
language plpgsql
immutable
as $$
begin
  return nullif(trim(p), '')::numeric;
exception when others then
  return null;
end;
$$;

create or replace function public.bpos_ts(p text)
returns timestamptz
language plpgsql
stable
as $$
begin
  return nullif(trim(p), '')::timestamptz;
exception when others then
  return null;
end;
$$;

-- Texto → uuid sin fallar (scope de sync_records es texto)
create or replace function public.branch_uuid(p text)
returns uuid
language plpgsql
immutable
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

-- Cada elemento de cada colección, venga como registro suelto o como
-- lista completa ('__doc__'), con su sucursal.
create or replace view public.bpos_elementos
with (security_invoker = on) as
select r.business_id,
       case when r.scope = 'business' then null else public.branch_uuid(r.scope) end as branch_id,
       r.collection,
       r.record_id,
       r.data as item,
       r.updated_at
from public.sync_records r
where not r.deleted
  and r.record_id <> '__doc__'
  and jsonb_typeof(r.data) = 'object'
union all
select r.business_id,
       case when r.scope = 'business' then null else public.branch_uuid(r.scope) end,
       r.collection,
       coalesce(e.item ->> 'id', e.item ->> 'sessionId', r.record_id || ':' || e.n::text),
       e.item,
       r.updated_at
from public.sync_records r
cross join lateral jsonb_array_elements(r.data) with ordinality as e(item, n)
where not r.deleted
  and r.record_id = '__doc__'
  and jsonb_typeof(r.data) = 'array'
  and jsonb_typeof(e.item) = 'object';

-- ---------------------------------------------------------------- ventas

create or replace view public.bpos_ventas
with (security_invoker = on) as
select e.business_id,
       e.branch_id,
       b.name                                                  as sucursal,
       e.record_id                                             as venta_id,
       public.bpos_num(e.item ->> 'localOrderNumber')::integer as folio,
       public.bpos_ts(e.item ->> 'createdAt')                  as fecha,
       coalesce(e.item -> 'details' ->> 'orderType', '')      as tipo,
       coalesce(e.item -> 'details' ->> 'paymentMethod', '')  as metodo_pago,
       coalesce(e.item ->> 'externalPlatform', e.item ->> 'source', 'POS') as canal,
       coalesce(e.item -> 'details' ->> 'customerName', '')   as cliente,
       coalesce(public.bpos_num(e.item ->> 'subtotal'), 0)     as subtotal,
       coalesce(public.bpos_num(e.item -> 'details' ->> 'discount'), 0) as descuento,
       coalesce(public.bpos_num(e.item ->> 'total'), 0)        as total,
       coalesce(jsonb_array_length(case when jsonb_typeof(e.item -> 'items') = 'array' then e.item -> 'items' end), 0) as partidas,
       e.item ->> 'shiftSessionId'                             as turno_id,
       e.updated_at                                            as actualizado
from public.bpos_elementos e
left join public.branches b on b.id = e.branch_id
where e.collection = 'bpos_orders';

create or replace view public.bpos_ventas_partidas
with (security_invoker = on) as
select e.business_id,
       e.branch_id,
       e.record_id                                         as venta_id,
       public.bpos_ts(e.item ->> 'createdAt')              as fecha,
       i.n::integer                                        as linea,
       public.bpos_num(i.item ->> 'id')::bigint            as producto_id,
       coalesce(i.item ->> 'name', '')                     as producto,
       coalesce(i.item ->> 'category', '')                 as categoria,
       coalesce(public.bpos_num(i.item ->> 'price'), 0)    as precio,
       coalesce(public.bpos_num(i.item ->> 'quantity'), 0) as cantidad,
       coalesce(public.bpos_num(i.item ->> 'price'), 0) * coalesce(public.bpos_num(i.item ->> 'quantity'), 0) as importe
from public.bpos_elementos e
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(e.item -> 'items') = 'array' then e.item -> 'items' else '[]'::jsonb end
) with ordinality as i(item, n)
where e.collection = 'bpos_orders'
  and jsonb_typeof(i.item) = 'object';

-- ---------------------------------------------------------------- catálogo

create or replace view public.bpos_productos
with (security_invoker = on) as
select e.business_id,
       public.bpos_num(e.item ->> 'id')::bigint         as producto_id,
       coalesce(e.item ->> 'name', '')                  as nombre,
       coalesce(e.item ->> 'category', '')              as categoria,
       coalesce(public.bpos_num(e.item ->> 'price'), 0) as precio,
       coalesce(e.item ->> 'station', '')               as estacion,
       coalesce(e.item ->> 'active', 'true') <> 'false'   as activo,
       e.updated_at                                     as actualizado
from public.bpos_elementos e
where e.collection = 'bpos_products';

create or replace view public.bpos_insumos
with (security_invoker = on) as
select e.business_id,
       e.branch_id,
       b.name                                             as sucursal,
       public.bpos_num(e.item ->> 'id')::bigint           as insumo_id,
       coalesce(e.item ->> 'name', '')                    as nombre,
       coalesce(e.item ->> 'unit', '')                    as unidad,
       coalesce(public.bpos_num(e.item ->> 'stock'), 0)   as existencia,
       coalesce(public.bpos_num(e.item ->> 'minimum'), 0) as minimo,
       coalesce(public.bpos_num(e.item ->> 'stock'), 0) <= coalesce(public.bpos_num(e.item ->> 'minimum'), 0) as bajo,
       e.updated_at                                       as actualizado
from public.bpos_elementos e
left join public.branches b on b.id = e.branch_id
where e.collection = 'bpos_inventory';

-- ---------------------------------------------------------------- compras

create or replace view public.bpos_compras
with (security_invoker = on) as
select e.business_id,
       e.branch_id,
       b.name                                           as sucursal,
       e.record_id                                      as compra_id,
       coalesce(e.item ->> 'folio', '')                 as folio,
       public.bpos_ts(e.item ->> 'createdAt')           as fecha,
       coalesce(e.item ->> 'supplier', '')              as proveedor,
       coalesce(e.item ->> 'invoice', '')               as ticket,
       coalesce(public.bpos_num(e.item ->> 'subtotal'), 0) as subtotal,
       coalesce(public.bpos_num(e.item ->> 'tax'), 0)   as impuestos,
       coalesce(public.bpos_num(e.item ->> 'total'), 0) as total,
       coalesce(e.item ->> 'status', 'confirmed')       as estado,
       coalesce(e.item ->> 'createdBy', '')             as registro
from public.bpos_elementos e
left join public.branches b on b.id = e.branch_id
where e.collection = 'bpos_purchases';

create or replace view public.bpos_compras_partidas
with (security_invoker = on) as
select e.business_id,
       e.branch_id,
       e.record_id                                               as compra_id,
       public.bpos_ts(e.item ->> 'createdAt')                    as fecha,
       coalesce(e.item ->> 'supplier', '')                       as proveedor,
       public.bpos_num(i.item ->> 'ingredientId')::bigint        as insumo_id,
       coalesce(i.item ->> 'ingredientName', '')                 as insumo,
       coalesce(public.bpos_num(i.item ->> 'inventoryQuantity'), 0) as cantidad,
       coalesce(i.item ->> 'unit', '')                           as unidad,
       coalesce(public.bpos_num(i.item ->> 'lineTotal'), 0)      as importe,
       coalesce(e.item ->> 'status', 'confirmed')                as estado
from public.bpos_elementos e
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(e.item -> 'items') = 'array' then e.item -> 'items' else '[]'::jsonb end
) as i(item)
where e.collection = 'bpos_purchases'
  and jsonb_typeof(i.item) = 'object';

create or replace view public.bpos_costos_insumos
with (security_invoker = on) as
select e.business_id,
       public.bpos_num(e.item ->> 'ingredientId')::bigint      as insumo_id,
       coalesce(e.item ->> 'ingredientName', '')               as insumo,
       coalesce(e.item ->> 'supplier', '')                     as proveedor,
       public.bpos_ts(e.item ->> 'purchasedAt')                as fecha,
       coalesce(public.bpos_num(e.item ->> 'unitCost'), 0)     as costo_unitario,
       coalesce(public.bpos_num(e.item ->> 'inventoryQuantity'), 0) as cantidad,
       coalesce(public.bpos_num(e.item ->> 'total'), 0)        as total
from public.bpos_elementos e
where e.collection = 'bpos_ingredient_cost_history';

-- ---------------------------------------------------------------- caja

create or replace view public.bpos_cortes_caja
with (security_invoker = on) as
select e.business_id,
       e.branch_id,
       b.name                                                 as sucursal,
       coalesce(e.item ->> 'sessionId', e.record_id)          as turno_id,
       public.bpos_ts(e.item ->> 'openedAt')                  as apertura,
       public.bpos_ts(e.item ->> 'closedAt')                  as cierre,
       coalesce(e.item -> 'openedBy' ->> 'name', '')          as abrio,
       coalesce(e.item -> 'closedBy' ->> 'name', '')          as cerro,
       coalesce(public.bpos_num(e.item ->> 'openingCash'), 0) as fondo_inicial,
       public.bpos_num(e.item ->> 'expectedCash')             as efectivo_esperado,
       public.bpos_num(e.item ->> 'countedCash')              as efectivo_contado,
       public.bpos_num(e.item ->> 'difference')               as diferencia,
       public.bpos_num(e.item -> 'salesSummary' ->> 'totalSales') as ventas
from public.bpos_elementos e
left join public.branches b on b.id = e.branch_id
where e.collection = 'bpos_shift_history';


-- Solo cuentas con sesión; cada una ve su negocio por las reglas de sync_records
revoke all on public.bpos_elementos, public.bpos_ventas, public.bpos_ventas_partidas,
  public.bpos_productos, public.bpos_insumos, public.bpos_compras, public.bpos_compras_partidas,
  public.bpos_costos_insumos, public.bpos_cortes_caja from anon;
grant select on public.bpos_elementos, public.bpos_ventas, public.bpos_ventas_partidas,
  public.bpos_productos, public.bpos_insumos, public.bpos_compras, public.bpos_compras_partidas,
  public.bpos_costos_insumos, public.bpos_cortes_caja to authenticated;

-- Búsquedas por colección más rápidas
create index if not exists sync_records_collection_idx
  on public.sync_records (business_id, collection) where not deleted;
