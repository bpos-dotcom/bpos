-- Registro de negocios nuevos (Crear cuenta en B-POS): códigos de
-- verificación que se mandan al correo antes de crear la cuenta.
-- Solo los usa el servidor (service role); nadie más los lee.

create table if not exists public.bpos_signup_codes (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  code_hash   text not null,
  attempts    int not null default 0,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists bpos_signup_codes_email_idx on public.bpos_signup_codes (email, created_at desc);

alter table public.bpos_signup_codes enable row level security;
revoke all on public.bpos_signup_codes from anon, authenticated;
