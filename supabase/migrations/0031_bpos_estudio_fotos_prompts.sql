-- =============================================================
-- B-POS · Prompts del Estudio Fotográfico editables
--
-- El dueño de B-POS cambia desde Configuración → Administrador → Claves de
-- IA → Estudio de fotos la orden que recibe la IA para conservar el fondo
-- (difuminado) y para quitarlo. Vacío = el prompt de fábrica del código
-- (lib/ai/photo-studio.ts).
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede correr más de una vez.
-- =============================================================

alter table public.bpos_ai_image_settings add column if not exists prompt_keep text not null default '';
alter table public.bpos_ai_image_settings add column if not exists prompt_remove text not null default '';
