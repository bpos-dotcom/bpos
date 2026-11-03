-- =============================================================
-- App de meseros (bpos.com.mx/meseros/<liga>)
--
-- Cada celular de mesero se vincula una vez con un código de 6 dígitos
-- que se genera en Configuración → Meseros. Al vincularse, Vercel (llave
-- de servicio) crea una cuenta de dispositivo (auth.users) miembro del
-- negocio con rol 'device' y la registra aquí; así el celular sincroniza
-- igual que una tablet, pero se puede desvincular desde Configuración.
-- =============================================================

create table if not exists public.bpos_waiter_devices (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  branch_id     uuid not null references public.branches (id) on delete cascade,
  user_id       uuid not null unique,                -- cuenta de dispositivo (auth.users)
  name          text not null default '',            -- "Celular de Ana"
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz,
  revoked_at    timestamptz
);
create index if not exists bpos_waiter_devices_branch_idx on public.bpos_waiter_devices (branch_id);

create table if not exists public.bpos_waiter_codes (
  code         text primary key,
  business_id  uuid not null references public.businesses (id) on delete cascade,
  branch_id    uuid not null references public.branches (id) on delete cascade,
  created_by   uuid,
  expires_at   timestamptz not null,
  used_at      timestamptz
);

alter table public.bpos_waiter_devices enable row level security;
alter table public.bpos_waiter_codes enable row level security;
revoke all on public.bpos_waiter_devices from anon, authenticated;
revoke all on public.bpos_waiter_codes from anon, authenticated;

-- Los miembros del negocio ven sus celulares vinculados (la escritura es solo del servidor)
drop policy if exists bpos_waiter_devices_member on public.bpos_waiter_devices;
create policy bpos_waiter_devices_member on public.bpos_waiter_devices
  for select to authenticated using (public.is_member(business_id));
grant select on public.bpos_waiter_devices to authenticated;
