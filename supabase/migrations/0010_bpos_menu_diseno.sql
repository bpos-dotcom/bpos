-- =============================================================
-- B-POS · Menú digital: fotos y "Los más pedidos"
--
-- Fotos de productos y del diseño del menú (portada, combo destacado,
-- banners) en Supabase Storage, carpeta por negocio:
--   bpos-media/<business_id>/...
-- Cualquiera puede verlas (el menú es público); solo los miembros del
-- negocio suben o borran las suyas.
--
-- bpos_menu_public ahora regresa la foto de cada producto y los más
-- vendidos de los últimos 30 días de la sucursal (ventas no canceladas).
-- =============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bpos-media', 'bpos-media', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists bpos_media_insert on storage.objects;
create policy bpos_media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'bpos-media'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists bpos_media_update on storage.objects;
create policy bpos_media_update on storage.objects
  for update to authenticated
  using (bucket_id = 'bpos-media' and public.is_member(((storage.foldername(name))[1])::uuid));

drop policy if exists bpos_media_delete on storage.objects;
create policy bpos_media_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'bpos-media' and public.is_member(((storage.foldername(name))[1])::uuid));

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
  v_top      json;
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
           'image', r.data->>'image',
           'description', r.data->>'description',
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

  -- Los más pedidos: piezas vendidas por producto en los últimos 30 días
  select coalesce(json_agg(json_build_object('id', t.id, 'qty', t.qty) order by t.qty desc), '[]'::json)
    into v_top
    from (
      select (i->>'id')::numeric as id, sum(coalesce((i->>'quantity')::numeric, 1)) as qty
        from sync_records r
        cross join lateral jsonb_array_elements(case when jsonb_typeof(r.data->'items') = 'array' then r.data->'items' else '[]'::jsonb end) i
       where r.business_id = v_link.business_id and r.scope = v_link.branch_id::text
         and r.collection = 'bpos_orders' and not r.deleted
         and r.updated_at > now() - interval '35 days'
         and coalesce(r.data->>'cancelled', 'false') <> 'true'
         and (r.data->>'createdAt') ~ '^\d{4}-\d{2}-\d{2}'
         and (r.data->>'createdAt')::timestamptz > now() - interval '30 days'
         and (i->>'id') ~ '^\d+$'
       group by 1
       order by 2 desc
       limit 12
    ) t;

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
    'top', v_top,
    'now', now()
  );
end;
$$;

revoke all on function public.bpos_menu_public(text) from public;
grant execute on function public.bpos_menu_public(text) to anon, authenticated;
