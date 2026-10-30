-- =============================================================
-- B-POS · Opiniones (Entrega 3)
--
-- Al recibir su pedido del menú digital, el cliente califica de 1 a 5
-- estrellas desde la liga de su pedido:
--   4 o 5 → se le invita a dejar su reseña en Google (liga del negocio);
--   1 a 3 → su opinión llega solo al negocio (Opiniones y aviso al celular)
--           para atenderla y marcarla como "atendida".
-- La liga de Google vive en bpos_digital_menu (googleReviewUrl).
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede correr más de una vez.
-- =============================================================

create table if not exists public.bpos_reviews (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  branch_id      uuid not null references public.branches (id) on delete cascade,
  order_id       uuid unique references public.bpos_online_orders (id) on delete set null,
  folio          text not null default '',
  stars          int not null check (stars between 1 and 5),
  comment        text not null default '',
  customer_name  text not null default '',
  customer_phone text not null default '',
  status         text not null default 'nueva' check (status in ('nueva', 'atendida')),
  answer         text not null default '',            -- cómo se atendió
  attended_by    text not null default '',
  attended_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists bpos_reviews_branch_idx
  on public.bpos_reviews (branch_id, created_at desc);

alter table public.bpos_reviews enable row level security;
-- Solo miembros del negocio (sin política para anon: el cliente entra por las funciones)
do $pol$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'bpos_reviews' and policyname = 'bpos_reviews_member') then
    create policy bpos_reviews_member on public.bpos_reviews
      for all to authenticated
      using (public.is_member(business_id))
      with check (public.is_member(business_id));
  end if;
end
$pol$;
grant select, update on public.bpos_reviews to authenticated;

-- El cliente califica su pedido (con la llave de su liga). Puede cambiar su
-- calificación ese mismo día. Regresa la liga de Google si dio 4 o 5.
create or replace function public.bpos_menu_review(p_id uuid, p_token text, p_stars int, p_comment text)
returns json
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_order  bpos_online_orders;
  v_menu   jsonb;
  v_review bpos_reviews;
  v_google text;
begin
  select * into v_order from bpos_online_orders where id = p_id and token = p_token;
  if not found then
    raise exception 'No encontramos tu pedido.';
  end if;
  if v_order.status not in ('listo', 'entregado') then
    raise exception 'Podrás calificar cuando recibas tu pedido.';
  end if;
  if p_stars is null or p_stars < 1 or p_stars > 5 then
    raise exception 'Elige de 1 a 5 estrellas.';
  end if;

  select * into v_review from bpos_reviews where order_id = v_order.id;
  if found and v_review.created_at < now() - interval '1 day' then
    raise exception 'Ya calificaste este pedido. ¡Gracias!';
  end if;

  insert into bpos_reviews (business_id, branch_id, order_id, folio, stars, comment, customer_name, customer_phone)
  values (
    v_order.business_id, v_order.branch_id, v_order.id, v_order.folio, p_stars,
    left(trim(coalesce(p_comment, '')), 600),
    left(coalesce(v_order.data->'customer'->>'name', ''), 80),
    left(coalesce(v_order.data->'customer'->>'phone', ''), 20)
  )
  on conflict (order_id) do update
    set stars = excluded.stars,
        comment = excluded.comment,
        status = case when excluded.stars <= 3 then 'nueva' else bpos_reviews.status end,
        updated_at = now()
  returning * into v_review;

  select data into v_menu from sync_records
   where business_id = v_order.business_id and scope = v_order.branch_id::text
     and collection = 'bpos_digital_menu' and record_id = '__doc__' and not deleted;
  v_google := coalesce(v_menu->>'googleReviewUrl', '');
  if v_google !~* '^https://\S+$' then
    v_google := '';
  end if;

  return json_build_object('id', v_review.id, 'stars', v_review.stars, 'google', case when p_stars >= 4 then v_google else '' end);
end;
$$;

-- Lo que ve el cliente de su pedido, ahora con su calificación
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
    'branch', (select name from branches where id = o.branch_id),
    'review', (select json_build_object('stars', r.stars, 'comment', r.comment) from bpos_reviews r where r.order_id = o.id)
  )
  from bpos_online_orders o
  where o.id = p_id and o.token = p_token;
$$;

grant execute on function public.bpos_menu_review(uuid, text, int, text) to anon, authenticated;
grant execute on function public.bpos_menu_order_status(uuid, text) to anon, authenticated;
