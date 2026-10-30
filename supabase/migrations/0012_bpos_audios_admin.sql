-- =============================================================
-- B-POS · Audios de avisos: solo el administrador de B-POS los sube
--
-- Los negocios suben fotos a su carpeta (bpos-media/<negocio>/...), pero
-- la carpeta "sonidos" de cualquier negocio solo la puede llenar el
-- administrador de la plataforma (is_platform_admin). Los negocios sí
-- cambian cuántas veces suena, color, parpadeo y repetición.
-- =============================================================

drop policy if exists bpos_media_insert on storage.objects;
create policy bpos_media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'bpos-media'
    and public.is_member(((storage.foldername(name))[1])::uuid)
    and ((storage.foldername(name))[2] is distinct from 'sonidos' or public.is_platform_admin())
  );

drop policy if exists bpos_media_update on storage.objects;
create policy bpos_media_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'bpos-media'
    and public.is_member(((storage.foldername(name))[1])::uuid)
    and ((storage.foldername(name))[2] is distinct from 'sonidos' or public.is_platform_admin())
  );
