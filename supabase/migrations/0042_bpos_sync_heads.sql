-- =====================================================================
-- B-POS · Aviso ligero de cambios para la sincronización
-- ---------------------------------------------------------------------
-- Los equipos escuchaban en tiempo real la tabla sync_records y cada aviso
-- traía el registro COMPLETO (en cada venta, el kardex entero) a cada
-- equipo: mucho tráfico de Supabase. Ahora escuchan sync_heads: una fila
-- por negocio con el último número de cambio. El aviso pesa casi nada y
-- el equipo baja solo lo que le falta.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run.
-- =====================================================================

create table if not exists public.sync_heads (
  -- Sin llave foránea: hay registros de negocios ya borrados y el aviso nunca debe frenar un cambio
  business_id uuid primary key,
  seq         bigint not null default 0,
  updated_at  timestamptz not null default now()
);

-- (por si se creó antes con la llave foránea)
alter table public.sync_heads drop constraint if exists sync_heads_business_id_fkey;

alter table public.sync_heads enable row level security;

drop policy if exists sync_heads_member_read on public.sync_heads;
create policy sync_heads_member_read on public.sync_heads
  for select to authenticated
  using (public.is_member(business_id));

revoke all on public.sync_heads from anon;
grant select on public.sync_heads to authenticated;

-- Cada cambio en sync_records mueve el número del negocio (una vez por
-- operación, con el número más alto).
create or replace function public.sync_heads_bump()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.sync_heads as h (business_id, seq, updated_at)
  select n.business_id, max(n.seq), now()
  from new_rows n
  group by n.business_id
  on conflict (business_id) do update
    set seq = greatest(h.seq, excluded.seq),
        updated_at = now();
  return null;
end;
$$;

drop trigger if exists sync_records_z_heads_ins on public.sync_records;
create trigger sync_records_z_heads_ins
  after insert on public.sync_records
  referencing new table as new_rows
  for each statement execute function public.sync_heads_bump();

drop trigger if exists sync_records_z_heads_upd on public.sync_records;
create trigger sync_records_z_heads_upd
  after update on public.sync_records
  referencing new table as new_rows
  for each statement execute function public.sync_heads_bump();

-- Tiempo real para sync_heads (sync_records se queda para los equipos sin actualizar)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and tablename = 'sync_heads') then
    alter publication supabase_realtime add table public.sync_heads;
  end if;
end;
$$;

-- Arranca con el número actual de cada negocio
insert into public.sync_heads (business_id, seq)
select business_id, max(seq) from public.sync_records group by business_id
on conflict (business_id) do update set seq = greatest(public.sync_heads.seq, excluded.seq);
