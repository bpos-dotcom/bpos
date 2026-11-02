-- =============================================================
-- B-POS · Reservaciones desde el menú digital
--
-- El cliente reserva mesa desde bpos.com.mx/m/<liga> (nombre, WhatsApp,
-- día, hora, personas y nota). El negocio la ve en Pedidos en línea →
-- Reservaciones y la confirma o rechaza (aviso por WhatsApp, gratis).
-- Se activa en Configuración → Menú digital → Reservaciones
-- (bpos_digital_menu.reservations).
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede correr más de una vez.
-- =============================================================

create table if not exists public.bpos_reservations (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  branch_id      uuid not null references public.branches (id) on delete cascade,
  token          text not null,
  customer_name  text not null,
  customer_phone text not null default '',
  people         int not null check (people between 1 and 100),
  reserved_at    timestamptz not null,
  note           text not null default '',
  status         text not null default 'nueva' check (status in ('nueva', 'confirmada', 'rechazada', 'cancelada', 'llego', 'no_llego')),
  reason         text not null default '',
  attended_by    text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists bpos_reservations_branch_idx
  on public.bpos_reservations (branch_id, reserved_at desc);

alter table public.bpos_reservations enable row level security;
do $pol$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'bpos_reservations' and policyname = 'bpos_reservations_member') then
    create policy bpos_reservations_member on public.bpos_reservations
      for all to authenticated
      using (public.is_member(business_id))
      with check (public.is_member(business_id));
  end if;
end
$pol$;
grant select, update on public.bpos_reservations to authenticated;

-- El cliente reserva (sin cuenta). Regresa id y llave para consultar cómo va.
create or replace function public.bpos_menu_reserve(p_slug text, p_reservation jsonb)
returns json
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_link   bpos_menu_links;
  v_menu   jsonb;
  v_res    jsonb;
  v_name   text;
  v_phone  text;
  v_people int;
  v_at     timestamptz;
  v_max    int;
  v_days   int;
  v_token  text := encode(gen_random_bytes(16), 'hex');
  v_id     uuid;
begin
  select * into v_link from bpos_menu_links where slug = lower(trim(coalesce(p_slug, '')));
  if not found then
    raise exception 'Este menú ya no existe.';
  end if;
  select data into v_menu from sync_records
   where business_id = v_link.business_id and scope = v_link.branch_id::text
     and collection = 'bpos_digital_menu' and record_id = '__doc__' and not deleted;
  v_res := coalesce(v_menu->'reservations', '{}'::jsonb);
  if coalesce((v_menu->>'enabled')::boolean, false) is false
     or coalesce((v_res->>'enabled')::boolean, false) is false then
    raise exception 'Por ahora este negocio no recibe reservaciones en línea.';
  end if;

  v_name   := trim(coalesce(p_reservation->>'name', ''));
  v_phone  := regexp_replace(coalesce(p_reservation->>'phone', ''), '\D', '', 'g');
  v_people := coalesce((p_reservation->>'people')::int, 0);
  v_at     := (p_reservation->>'at')::timestamptz;
  v_max    := greatest(1, coalesce((v_res->>'maxPeople')::int, 12));
  v_days   := greatest(1, coalesce((v_res->>'maxDays')::int, 30));

  if v_name = '' then
    raise exception 'Escribe tu nombre.';
  end if;
  if length(v_phone) < 10 then
    raise exception 'Escribe tu WhatsApp a 10 dígitos para confirmarte.';
  end if;
  if v_people < 1 or v_people > v_max then
    raise exception 'Reservamos mesas de 1 a % personas. Para más, escríbenos por WhatsApp.', v_max;
  end if;
  if v_at is null or v_at < now() + interval '30 minutes' then
    raise exception 'Elige una hora con al menos 30 minutos de anticipación.';
  end if;
  if v_at > now() + make_interval(days => v_days) then
    raise exception 'Solo se puede reservar hasta % días antes.', v_days;
  end if;
  if (select count(*) from bpos_reservations
       where branch_id = v_link.branch_id and status = 'nueva') >= 60 then
    raise exception 'El negocio tiene muchas reservaciones por revisar. Intenta más tarde.';
  end if;

  insert into bpos_reservations (business_id, branch_id, token, customer_name, customer_phone, people, reserved_at, note)
  values (v_link.business_id, v_link.branch_id, v_token, left(v_name, 80), left(v_phone, 13), v_people, v_at, left(coalesce(p_reservation->>'note', ''), 300))
  returning id into v_id;

  delete from bpos_reservations
   where branch_id = v_link.branch_id and reserved_at < now() - interval '90 days';

  return json_build_object('id', v_id, 'token', v_token);
end;
$$;

-- El cliente consulta cómo va su reservación (con su llave)
create or replace function public.bpos_menu_reservation_status(p_id uuid, p_token text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object('status', r.status, 'reason', r.reason, 'reserved_at', r.reserved_at, 'people', r.people)
  from bpos_reservations r
  where r.id = p_id and r.token = p_token;
$$;

-- El cliente cancela su reservación
create or replace function public.bpos_menu_reservation_cancel(p_id uuid, p_token text)
returns boolean
language sql
volatile
security definer
set search_path = public
as $$
  update bpos_reservations set status = 'cancelada', updated_at = now()
  where id = p_id and token = p_token and status in ('nueva', 'confirmada')
  returning true;
$$;

grant execute on function public.bpos_menu_reserve(text, jsonb) to anon, authenticated;
grant execute on function public.bpos_menu_reservation_status(uuid, text) to anon, authenticated;
grant execute on function public.bpos_menu_reservation_cancel(uuid, text) to anon, authenticated;
