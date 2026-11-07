-- =============================================================
-- B-POS · BPOS Credits por día, semana o mes
--
-- El dueño de B-POS elige cada cuánto se reinician los BPOS Credits del
-- Estudio de fotos: 'dia' (como antes), 'semana' (el lunes) o 'mes' (el
-- día 1), hora de México. credits_per_day pasa a ser "cuántos hay en el
-- periodo". Los usados siguen en bpos_ai_credits: el día guardado es el
-- primer día del periodo (el lunes o el día 1).
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede correr más de una vez.
-- =============================================================

alter table public.bpos_ai_image_settings add column if not exists credits_period text not null default 'dia';

alter table public.bpos_ai_image_settings drop constraint if exists bpos_ai_image_settings_credits_period_check;
alter table public.bpos_ai_image_settings add constraint bpos_ai_image_settings_credits_period_check check (credits_period in ('dia', 'semana', 'mes'));
