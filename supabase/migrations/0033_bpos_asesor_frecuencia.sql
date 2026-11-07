-- =============================================================
-- B-POS · Cada cuánto se puede pedir un análisis nuevo del Asesor
--
-- El dueño de B-POS elige en Configuración → Administrador → Claves de
-- IA → Asesor si cada negocio puede pedir un análisis nuevo diario, cada
-- 3 días o cada semana (refresh_days). El servidor lo hace respetar con
-- la hora del último análisis de cada negocio (last_analysis_at), así no
-- se brinca cambiando de celular.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede correr más de una vez.
-- =============================================================

alter table public.bpos_ai_settings add column if not exists refresh_days integer not null default 1;

alter table public.bpos_ai_settings drop constraint if exists bpos_ai_settings_refresh_days_check;
alter table public.bpos_ai_settings add constraint bpos_ai_settings_refresh_days_check check (refresh_days in (1, 3, 7));

alter table public.bpos_advisor_weekly add column if not exists last_analysis_at timestamptz;
