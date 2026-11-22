-- =============================================================
-- B-POS · Mudanza a la nube de Cloudflare: exportar usuarios
--
-- La nube de Cloudflare copia los usuarios con su contraseña cifrada
-- (bcrypt, la misma de Supabase) para que todos entren igual que siempre,
-- sin volver a registrarse. Solo la llave del servidor (service_role) la
-- puede usar; nadie con sesión ni sin sesión.
--
-- No cambia nada de lo que ya funciona. Se puede correr más de una vez.
-- =============================================================

create or replace function public.nube_export_usuarios(p_offset int default 0, p_limit int default 500)
returns table (
  id uuid,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb,
  raw_app_meta_data jsonb,
  banned_until timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.id, u.email::text, u.encrypted_password::text, u.email_confirmed_at, u.raw_user_meta_data, u.raw_app_meta_data,
         u.banned_until, u.last_sign_in_at, u.created_at, u.updated_at
    from auth.users u
   where u.deleted_at is null
   order by u.created_at, u.id
   offset greatest(0, coalesce(p_offset, 0))
   limit least(1000, greatest(1, coalesce(p_limit, 500)));
$$;

revoke all on function public.nube_export_usuarios(int, int) from public, anon, authenticated;
grant execute on function public.nube_export_usuarios(int, int) to service_role;
