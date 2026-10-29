-- =====================================================================
-- B-POS · Bloque 11 (parte 4) · Bitácora inalterable y ventas sin borrado
-- ---------------------------------------------------------------------
-- Todas las cajas y celulares entran con la misma cuenta del negocio, así
-- que la nube no sabe si quien hace algo es el cajero o el Admin. Para que
-- nada se pueda ocultar:
--
-- 1. audit_events: bitácora en la nube. Los dispositivos solo pueden
--    AGREGAR eventos (descuentos, cancelaciones, cierres de caja, cambios de
--    precios o usuarios...). Nadie puede editarlos ni borrarlos.
-- 2. Ventas (bpos_orders en sync_records): la nube ignora cualquier intento
--    de borrarlas. En B-POS ya no se borran: se cancelan con motivo.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede correr más de una vez.
-- =====================================================================

create table if not exists public.audit_events (
  id           bigint generated always as identity primary key,
  business_id  uuid not null references public.businesses (id) on delete cascade,
  branch_id    uuid,
  event_id     text not null,            -- id local del evento (evita duplicados al reintentar)
  category     text not null,
  action       text not null,
  description  text not null default '',
  user_name    text,
  user_id      text,
  entity_id    text,
  device_id    text,
  metadata     jsonb,
  happened_at  timestamptz not null,     -- cuándo pasó en el dispositivo
  received_at  timestamptz not null default now(),  -- cuándo llegó a la nube (no lo pone el dispositivo)
  unique (business_id, event_id)
);

create index if not exists audit_events_business_idx
  on public.audit_events (business_id, happened_at desc);

alter table public.audit_events enable row level security;

drop policy if exists audit_events_insert on public.audit_events;
create policy audit_events_insert on public.audit_events
  for insert to authenticated
  with check (public.is_member(business_id));

drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events
  for select to authenticated
  using (public.is_member(business_id));

-- Sin políticas de UPDATE ni DELETE: denegado. Y por si acaso, también por permisos y por trigger.
revoke all on public.audit_events from anon;
revoke update, delete, truncate on public.audit_events from authenticated;
grant select, insert on public.audit_events to authenticated;

create or replace function public.audit_events_inmutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'La bitácora de B-POS no se puede modificar ni borrar.';
end;
$$;

drop trigger if exists audit_events_inmutable on public.audit_events;
create trigger audit_events_inmutable
  before update or delete on public.audit_events
  for each row execute function public.audit_events_inmutable();

-- La hora de llegada la pone la nube, aunque el dispositivo mande otra
create or replace function public.audit_events_received()
returns trigger
language plpgsql
as $$
begin
  new.received_at := now();
  return new;
end;
$$;

drop trigger if exists audit_events_received on public.audit_events;
create trigger audit_events_received
  before insert on public.audit_events
  for each row execute function public.audit_events_received();

-- ---------------------------------------------------------------------
-- Ventas: la nube no deja borrarlas
-- ---------------------------------------------------------------------
-- Se llama "sync_records_a_keep_sales" para correr antes que
-- "sync_records_touch" (los triggers corren en orden alfabético).
create or replace function public.sync_records_a_keep_sales()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.collection = 'bpos_orders' then
      return null; -- se ignora el borrado
    end if;
    return old;
  end if;
  -- Marcar una venta como borrada: se conserva como estaba
  if new.collection = 'bpos_orders' and new.deleted and not old.deleted then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_records_a_keep_sales on public.sync_records;
create trigger sync_records_a_keep_sales
  before update or delete on public.sync_records
  for each row execute function public.sync_records_a_keep_sales();
