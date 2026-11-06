-- =============================================================
-- B-POS · Estudio de fotos con OpenAI
--
-- El Estudio de fotos (0029) también trabaja con OpenAI (gpt-image-1).
-- bpos_ai_photo_settings solo aceptaba Gemini; en lugar de cambiar su
-- regla se crea bpos_ai_image_settings con las mismas columnas y OpenAI
-- permitido (la de 0029 quedó vacía y ya no se usa). bpos_ai_credits y
-- sus funciones (0029) siguen igual.
--
-- Sin políticas: solo el servidor de B-POS (llave de servicio) la lee y
-- escribe. La clave nunca regresa al navegador.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede correr más de una vez.
-- =============================================================

create table if not exists public.bpos_ai_image_settings (
  feature          text primary key default 'fotos' check (feature = 'fotos'),
  provider         text not null default 'openai' check (provider in ('openai', 'gemini')),
  model            text not null default 'gpt-image-1',
  key_cipher       text not null default '',
  key_hint         text not null default '',
  price_in         numeric not null default 0,
  price_out        numeric not null default 0,
  credits_per_day  integer not null default 25 check (credits_per_day >= 0),
  credits_per_use  integer not null default 5 check (credits_per_use > 0),
  updated_by       text not null default '',
  updated_at       timestamptz not null default now()
);

alter table public.bpos_ai_image_settings enable row level security;
