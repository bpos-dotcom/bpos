-- =============================================================
-- B-POS · Asesor con IA: opción "Sin límite"
--
-- Además de diario, cada 3 días o cada semana, el dueño de B-POS puede
-- elegir "Sin límite" (refresh_days = 0) para probar el asesor: cada
-- negocio pide un análisis nuevo cuantas veces quiera.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede correr más de una vez.
-- =============================================================

alter table public.bpos_ai_settings drop constraint if exists bpos_ai_settings_refresh_days_check;
alter table public.bpos_ai_settings add constraint bpos_ai_settings_refresh_days_check check (refresh_days in (0, 1, 3, 7));
