-- =====================================================================
-- B-POS · Bloque 11 (parte 2) · Sincronización con la nube
-- ---------------------------------------------------------------------
-- Requiere haber corrido antes 0001_bpos_schema.sql (negocios,
-- sucursales y miembros).
--
-- B-POS guarda sus datos en el navegador (llaves "bpos_*"). Esta tabla
-- guarda una copia en la nube, registro por registro, para que todas
-- las computadoras, tablets y celulares del negocio vean lo mismo.
--   scope = id de la sucursal  → datos de la sucursal (ventas, caja,
--                                inventario, cocina...)
--   scope = 'business'         → datos de todo el negocio (productos,
--                                recetas, usuarios, proveedores...)
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run.
-- =====================================================================

create sequence if not exists public.sync_seq;

create table if not exists public.sync_records (
  business_id  uuid not null references public.businesses (id) on delete cascade,
  scope        text not null,
  collection   text not null,             -- llave del navegador, ej. bpos_orders
  record_id    text not null,             -- id del registro, o '__doc__'
  data         jsonb,                     -- null cuando se borró
  deleted      boolean not null default false,
  seq          bigint not null default nextval('public.sync_seq'),
  updated_at   timestamptz not null default now(),
  updated_by   text not null default '',  -- dispositivo que hizo el cambio
  primary key (business_id, scope, collection, record_id)
);

create index if not exists sync_records_pull_idx
  on public.sync_records (business_id, seq);

-- Cada cambio recibe un número nuevo para que los demás dispositivos
-- descarguen solo lo que cambió desde la última vez.
create or replace function public.sync_records_touch()
returns trigger
language plpgsql
as $$
begin
  new.seq := nextval('public.sync_seq');
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists sync_records_touch on public.sync_records;
create trigger sync_records_touch
  before insert or update on public.sync_records
  for each row execute function public.sync_records_touch();

alter table public.sync_records enable row level security;

drop policy if exists sync_records_member_all on public.sync_records;
create policy sync_records_member_all on public.sync_records
  for all to authenticated
  using (public.is_member(business_id))
  with check (
    public.is_member(business_id)
    and (scope = 'business'
         or exists (select 1 from public.branches b
                    where b.id::text = scope and b.business_id = sync_records.business_id))
  );

revoke all on public.sync_records from anon;
grant select, insert, update, delete on public.sync_records to authenticated;
grant usage, select on sequence public.sync_seq to authenticated;

-- Alta de negocio sin datos de ejemplo: la cuenta queda como dueña.
create or replace function public.create_business(p_business_name text, p_branch_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_business  uuid;
  v_branch    uuid;
begin
  if v_uid is null then
    raise exception 'NO_AUTENTICADO' using errcode = '42501';
  end if;
  if coalesce(trim(p_business_name), '') = '' then
    raise exception 'Falta el nombre del negocio.';
  end if;

  insert into businesses (name, owner_id) values (trim(p_business_name), v_uid)
    returning id into v_business;
  insert into branches (business_id, name)
    values (v_business, coalesce(nullif(trim(p_branch_name), ''), 'Matriz'))
    returning id into v_branch;
  insert into business_members (business_id, user_id, role) values (v_business, v_uid, 'owner');
  insert into branch_counters (branch_id) values (v_branch);

  return json_build_object('business_id', v_business, 'branch_id', v_branch);
end;
$$;

revoke execute on function public.create_business(text, text) from public, anon;
grant execute on function public.create_business(text, text) to authenticated;
revoke execute on function public.sync_records_touch() from public, anon;

-- Tiempo real: avisa a los demás dispositivos cuando algo cambia
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and tablename = 'sync_records') then
    alter publication supabase_realtime add table public.sync_records;
  end if;
end;
$$;
