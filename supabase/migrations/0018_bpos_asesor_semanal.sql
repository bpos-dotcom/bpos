-- =============================================================
-- B-POS · Resumen del Asesor con IA por correo cada lunes
--
-- El dueño lo activa en la App del dueño → Asesor IA. B-POS sube una vez
-- al día los números del negocio (metrics) y el lunes el servidor
-- (cron de Vercel, app/api/cron/asesor-semanal) arma el análisis y lo
-- manda por correo con Resend. last_week evita mandarlo dos veces.
--
-- Sin políticas: solo el servidor de B-POS (llave de servicio).
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede correr más de una vez.
-- =============================================================

create table if not exists public.bpos_advisor_weekly (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  enabled     boolean not null default false,
  email       text not null default '',
  metrics     jsonb,
  metrics_at  timestamptz,
  last_week   text not null default '',
  last_error  text not null default '',
  updated_at  timestamptz not null default now()
);

alter table public.bpos_advisor_weekly enable row level security;
