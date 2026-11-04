-- =============================================================
-- Permiso de uso firmado (candado contra usar B-POS sin pagar).
--
-- El servidor (Vercel, llave de servicio) firma con Ed25519 un permiso
-- "este negocio puede trabajar hasta tal fecha" (lo pagado o la prueba,
-- y como máximo 3 días sin volver a conectarse). B-POS y B-POS Agent lo
-- verifican con la llave pública. La llave privada la genera el propio
-- servidor la primera vez y solo vive aquí: nadie más puede leerla.
-- =============================================================

create table if not exists public.bpos_license_keys (
  id           int primary key default 1 check (id = 1),
  public_key   text not null,   -- Ed25519, JWK "x" (base64url)
  private_key  text not null,   -- PKCS8 PEM
  created_at   timestamptz not null default now()
);

alter table public.bpos_license_keys enable row level security;
revoke all on public.bpos_license_keys from anon, authenticated;
