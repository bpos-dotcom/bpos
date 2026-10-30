-- =============================================================
-- B-POS · Cupones en el menú digital (Entrega 4)
--
-- Los cupones viven en sync_records (bpos_coupons, scope 'business'): los
-- crea el negocio en Clientes → Cupones y también sirven en el POS. Aquí
-- solo se revisa un código para el cliente del menú digital, con las
-- mismas reglas que B-POS (activo, vigencia, usos, compra mínima). El
-- descuento final lo vuelve a calcular B-POS al aceptar el pedido.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede correr más de una vez.
-- =============================================================

create or replace function public.bpos_menu_coupon(p_slug text, p_code text, p_subtotal numeric)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_link     bpos_menu_links;
  v_code     text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9Ññ-]', '', 'g'));
  v_c        jsonb;
  v_today    text := to_char(now() at time zone 'America/Mexico_City', 'YYYY-MM-DD');
  v_pending  int;
  v_value    numeric;
  v_discount numeric;
  v_cap      numeric;
begin
  select * into v_link from bpos_menu_links where slug = lower(trim(coalesce(p_slug, '')));
  if not found then
    raise exception 'Este menú ya no existe.';
  end if;
  if v_code = '' then
    raise exception 'Escribe el código del cupón.';
  end if;

  select data into v_c from sync_records
   where business_id = v_link.business_id and scope = 'business'
     and collection = 'bpos_coupons' and not deleted
     and upper(data->>'code') = v_code
   limit 1;
  if v_c is null then
    raise exception 'Ese cupón no existe.';
  end if;
  if coalesce((v_c->>'active')::boolean, false) is false or coalesce((v_c->>'online')::boolean, false) is false then
    raise exception 'Ese cupón no está disponible en el menú digital.';
  end if;
  if coalesce(v_c->>'from', '') <> '' and v_today < v_c->>'from' then
    raise exception 'Ese cupón todavía no empieza.';
  end if;
  if coalesce(v_c->>'until', '') <> '' and v_today > v_c->>'until' then
    raise exception 'Ese cupón ya venció.';
  end if;
  -- Usos: los de las ventas + los pedidos en línea que esperan ser aceptados
  if coalesce((v_c->>'maxUses')::int, 0) > 0 then
    select count(*) into v_pending from bpos_online_orders
     where business_id = v_link.business_id and status in ('nuevo', 'aceptando')
       and upper(data->'coupon'->>'code') = v_code;
    if coalesce((v_c->>'uses')::int, 0) + v_pending >= (v_c->>'maxUses')::int then
      raise exception 'Ese cupón ya se agotó.';
    end if;
  end if;
  if coalesce((v_c->>'minPurchase')::numeric, 0) > coalesce(p_subtotal, 0) then
    raise exception 'Ese cupón es para compras desde $%.', (v_c->>'minPurchase')::numeric;
  end if;

  v_value := coalesce((v_c->>'value')::numeric, 0);
  v_cap := coalesce((v_c->>'maxDiscount')::numeric, 0);
  if v_c->>'kind' = 'percent' then
    v_discount := coalesce(p_subtotal, 0) * v_value / 100;
    if v_cap > 0 then
      v_discount := least(v_discount, v_cap);
    end if;
  else
    v_discount := v_value;
  end if;
  v_discount := round(greatest(0, least(v_discount, coalesce(p_subtotal, 0))), 2);

  return json_build_object(
    'code', v_code,
    'discount', v_discount,
    'kind', v_c->>'kind',
    'value', v_value,
    'minPurchase', coalesce((v_c->>'minPurchase')::numeric, 0),
    'maxDiscount', v_cap
  );
end;
$$;

grant execute on function public.bpos_menu_coupon(text, text, numeric) to anon, authenticated;
