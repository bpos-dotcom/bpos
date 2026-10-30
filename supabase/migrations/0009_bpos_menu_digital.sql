-- =============================================================
-- B-POS · Menú digital y pedidos en línea (Entrega 1)
--
-- Cada sucursal puede tener su menú público en bpos.com.mx/m/<liga>.
-- El cliente ve el menú (sin iniciar sesión), arma su pedido y lo manda;
-- el pedido llega a "Pedidos en línea" de la sucursal y al aceptarlo se
-- vuelve una venta más (Cocina, comandas, Caja).
--
-- Los productos y los ajustes del menú ya viven en sync_records:
--   bpos_products         (scope 'business', un registro por producto)
--   bpos_business_settings (scope 'business', __doc__): nombre, logo, color
--   bpos_digital_menu     (scope = id de la sucursal, __doc__): ocultos,
--                          agotados, horario, recoger/domicilio, mesas...
-- Estas funciones solo leen de ahí lo que el cliente puede ver.
-- =============================================================

-- Liga pública de cada sucursal (bpos.com.mx/m/burger-planet)
create table if not exists public.bpos_menu_links (
  slug         text primary key check (slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$'),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  branch_id    uuid not null unique references public.branches (id) on delete cascade,
  created_at   timestamptz not null default now()
);

alter table public.bpos_menu_links enable row level security;
drop policy if exists bpos_menu_links_member on public.bpos_menu_links;
create policy bpos_menu_links_member on public.bpos_menu_links
  for select to authenticated using (public.is_member(business_id));
revoke all on public.bpos_menu_links from anon;
grant select on public.bpos_menu_links to authenticated;

-- Pedidos que mandan los clientes desde el menú
create table if not exists public.bpos_online_orders (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  branch_id     uuid not null references public.branches (id) on delete cascade,
  folio         text not null,
  token         text not null,                      -- para que el cliente vea su pedido
  status        text not null default 'nuevo'
                check (status in ('nuevo', 'aceptando', 'aceptado', 'rechazado', 'listo', 'entregado')),
  data          jsonb not null,                     -- cliente, renglones, total que vio
  sale_order_id bigint,                             -- venta creada al aceptar
  eta_minutes   int,
  reason        text,                               -- motivo si se rechazó
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists bpos_online_orders_branch_idx
  on public.bpos_online_orders (branch_id, created_at desc);
create index if not exists bpos_online_orders_new_idx
  on public.bpos_online_orders (branch_id) where status in ('nuevo', 'aceptando');

alter table public.bpos_online_orders enable row level security;
drop policy if exists bpos_online_orders_member on public.bpos_online_orders;
create policy bpos_online_orders_member on public.bpos_online_orders
  for all to authenticated
  using (public.is_member(business_id))
  with check (public.is_member(business_id));
revoke all on public.bpos_online_orders from anon;
grant select, update on public.bpos_online_orders to authenticated;

-- ------------------------------------------------------------- liga

-- El dueño elige la liga de su sucursal (o la cambia)
create or replace function public.bpos_menu_set_slug(p_branch_id uuid, p_slug text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_business uuid := public.branch_business(p_branch_id);
  v_slug     text := lower(trim(coalesce(p_slug, '')));
begin
  if v_business is null or not public.is_member(v_business) then
    raise exception 'Sucursal no encontrada';
  end if;
  if v_slug !~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$' then
    raise exception 'La liga solo lleva letras, números y guiones (3 a 40).';
  end if;
  if exists (select 1 from bpos_menu_links where slug = v_slug and branch_id <> p_branch_id) then
    raise exception 'Esa liga ya la usa otro negocio. Prueba con otra.';
  end if;
  delete from bpos_menu_links where branch_id = p_branch_id;
  insert into bpos_menu_links (slug, business_id, branch_id) values (v_slug, v_business, p_branch_id);
  return v_slug;
end;
$$;

-- ------------------------------------------------------------- menú público

-- Lo que el cliente ve: negocio, sucursal, ajustes del menú y productos a la venta
create or replace function public.bpos_menu_public(p_slug text)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_link     bpos_menu_links;
  v_settings jsonb;
  v_menu     jsonb;
  v_products json;
begin
  select * into v_link from bpos_menu_links where slug = lower(trim(coalesce(p_slug, '')));
  if not found then
    return null;
  end if;

  select data into v_settings from sync_records
   where business_id = v_link.business_id and scope = 'business'
     and collection = 'bpos_business_settings' and record_id = '__doc__' and not deleted;
  select data into v_menu from sync_records
   where business_id = v_link.business_id and scope = v_link.branch_id::text
     and collection = 'bpos_digital_menu' and record_id = '__doc__' and not deleted;

  -- Solo lo que necesita la página (sin costos ni recetas)
  select coalesce(json_agg(json_build_object(
           'id', (r.data->>'id')::numeric,
           'name', r.data->>'name',
           'category', r.data->>'category',
           'price', (r.data->>'price')::numeric,
           'emoji', r.data->>'emoji',
           'station', r.data->>'station',
           'notSoldAlone', coalesce((r.data->>'notSoldAlone')::boolean, false),
           'noOwnTicket', coalesce((r.data->>'noOwnTicket')::boolean, false),
           'modifierGroups', r.data->'modifierGroups',
           'saleSchedule', r.data->'saleSchedule'
         )), '[]'::json)
    into v_products
    from sync_records r
   where r.business_id = v_link.business_id and r.scope = 'business'
     and r.collection = 'bpos_products' and not r.deleted and r.data ? 'id';

  return json_build_object(
    'slug', v_link.slug,
    'business', json_build_object(
      'name', coalesce(v_settings->>'businessName', (select name from businesses where id = v_link.business_id)),
      'logo', coalesce(v_settings->>'brandLogo', ''),
      'color', coalesce(v_settings->>'brandColor', '#f97316')
    ),
    'branch', (select name from branches where id = v_link.branch_id),
    'menu', coalesce(v_menu, '{}'::jsonb),
    'products', v_products,
    'now', now()
  );
end;
$$;

-- ------------------------------------------------------------- pedidos

-- El cliente manda su pedido. B-POS lo revisa (precios, agotados) al aceptarlo.
create or replace function public.bpos_menu_place_order(p_slug text, p_order jsonb)
returns json
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_link     bpos_menu_links;
  v_menu     jsonb;
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes    bytea;
  v_folio    text;
  v_token    text := encode(gen_random_bytes(16), 'hex');
  v_id       uuid;
begin
  select * into v_link from bpos_menu_links where slug = lower(trim(coalesce(p_slug, '')));
  if not found then
    raise exception 'Este menú ya no existe.';
  end if;
  select data into v_menu from sync_records
   where business_id = v_link.business_id and scope = v_link.branch_id::text
     and collection = 'bpos_digital_menu' and record_id = '__doc__' and not deleted;
  if coalesce((v_menu->>'enabled')::boolean, false) is false
     or coalesce((v_menu->>'acceptOrders')::boolean, false) is false then
    raise exception 'Por ahora este negocio no está recibiendo pedidos en línea.';
  end if;

  if p_order is null or jsonb_typeof(p_order->'lines') <> 'array'
     or jsonb_array_length(p_order->'lines') = 0 then
    raise exception 'Tu pedido está vacío.';
  end if;
  if jsonb_array_length(p_order->'lines') > 60 or length(p_order::text) > 60000 then
    raise exception 'El pedido es demasiado grande. Divídelo en dos.';
  end if;
  if coalesce(trim(p_order->'customer'->>'name'), '') = '' then
    raise exception 'Escribe tu nombre.';
  end if;
  -- Freno contra abusos: no más de 40 pedidos sin atender por sucursal
  if (select count(*) from bpos_online_orders
       where branch_id = v_link.branch_id and status = 'nuevo') >= 40 then
    raise exception 'El negocio tiene muchos pedidos en este momento. Intenta en unos minutos.';
  end if;

  loop
    v_bytes := gen_random_bytes(4);
    v_folio := '';
    for i in 0..3 loop
      v_folio := v_folio || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % length(v_alphabet)), 1);
    end loop;
    exit when not exists (select 1 from bpos_online_orders
                           where branch_id = v_link.branch_id and folio = v_folio
                             and created_at > now() - interval '7 days');
  end loop;

  insert into bpos_online_orders (business_id, branch_id, folio, token, data)
  values (v_link.business_id, v_link.branch_id, v_folio, v_token, p_order)
  returning id into v_id;

  -- Los pedidos de más de 60 días ya no se necesitan
  delete from bpos_online_orders
   where branch_id = v_link.branch_id and created_at < now() - interval '60 days';

  return json_build_object('id', v_id, 'token', v_token, 'folio', v_folio);
end;
$$;

-- El cliente consulta cómo va su pedido (con la llave que recibió al pedir)
create or replace function public.bpos_menu_order_status(p_id uuid, p_token text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'folio', o.folio,
    'status', o.status,
    'eta_minutes', o.eta_minutes,
    'reason', o.reason,
    'created_at', o.created_at,
    'updated_at', o.updated_at,
    'data', o.data,
    'branch', (select name from branches where id = o.branch_id)
  )
  from bpos_online_orders o
  where o.id = p_id and o.token = p_token;
$$;

-- Solo un dispositivo acepta cada pedido: lo "toma" antes de crear la venta
create or replace function public.bpos_online_claim(p_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  update bpos_online_orders
     set status = 'aceptando', updated_at = now()
   where id = p_id and public.is_member(business_id)
     and (status = 'nuevo' or (status = 'aceptando' and updated_at < now() - interval '2 minutes'))
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

revoke all on function public.bpos_menu_set_slug(uuid, text) from public, anon;
grant execute on function public.bpos_menu_set_slug(uuid, text) to authenticated;
revoke all on function public.bpos_menu_public(text) from public;
grant execute on function public.bpos_menu_public(text) to anon, authenticated;
revoke all on function public.bpos_menu_place_order(text, jsonb) from public;
grant execute on function public.bpos_menu_place_order(text, jsonb) to anon, authenticated;
revoke all on function public.bpos_menu_order_status(uuid, text) from public;
grant execute on function public.bpos_menu_order_status(uuid, text) to anon, authenticated;
revoke all on function public.bpos_online_claim(uuid) from public, anon;
grant execute on function public.bpos_online_claim(uuid) to authenticated;
