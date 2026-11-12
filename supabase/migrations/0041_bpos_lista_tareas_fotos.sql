-- =============================================================
-- Listas de tareas con foto por tarea (Productividad)
--
-- Un folio de bpos_task_evidence puede ser de una lista: `items` guarda cada
-- tarea ({ name, photo: pide foto, url, done, by, at }). El QR de la lista
-- abre /evidencia/<token> en los celulares; cada quien palomea o sube la foto
-- de su tarea y la caja lee el avance hasta que se terminan todas.
-- Solo el servidor (llave de servicio) usa esta tabla y esta función.
-- =============================================================

alter table public.bpos_task_evidence add column if not exists items jsonb;

-- Cambia UNA tarea de la lista sin pisar lo que otro celular cambió al mismo tiempo
create or replace function public.bpos_task_evidence_item(p_token text, p_index int, p_patch jsonb)
returns jsonb
language sql
security definer
set search_path = public
as $$
  update public.bpos_task_evidence
     set items = jsonb_set(items, array[p_index::text], (items -> p_index) || p_patch)
   where token = p_token
     and items is not null
     and p_index >= 0
     and p_index < jsonb_array_length(items)
  returning items;
$$;

revoke all on function public.bpos_task_evidence_item(text, int, jsonb) from public, anon, authenticated;
grant execute on function public.bpos_task_evidence_item(text, int, jsonb) to service_role;
