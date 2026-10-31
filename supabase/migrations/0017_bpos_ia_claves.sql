-- =============================================================
-- B-POS · Claves de IA de la plataforma (solo el dueño de B-POS)
--
-- Por función (interprete = fotos de tickets, menús y Bridge; asesor =
-- Asesor con IA): proveedor (anthropic | gemini), modelo, la clave
-- CIFRADA (AES-256-GCM, la llave de cifrado vive solo en Vercel) y el
-- precio por millón de tokens para llevar el presupuesto de cada negocio.
--
-- Sin políticas: solo el servidor de B-POS (llave de servicio) la lee y
-- escribe, después de revisar que quien la cambia es administrador de la
-- plataforma (is_platform_admin). La clave nunca regresa al navegador.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede correr más de una vez.
-- =============================================================

create table if not exists public.bpos_ai_settings (
  feature     text primary key check (feature in ('interprete', 'asesor')),
  provider    text not null check (provider in ('anthropic', 'gemini')),
  model       text not null,
  key_cipher  text not null default '',
  key_hint    text not null default '',
  price_in    numeric not null default 0,   -- dólares por millón de tokens de entrada
  price_out   numeric not null default 0,   -- dólares por millón de tokens de salida
  updated_by  text not null default '',
  updated_at  timestamptz not null default now()
);

alter table public.bpos_ai_settings enable row level security;
