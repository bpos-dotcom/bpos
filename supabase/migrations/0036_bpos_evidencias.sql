-- =============================================================
-- Fotos de evidencia de Productividad (recordatorios que piden foto)
--
-- La caja pide un folio (token) y muestra un QR; el empleado lo abre en su
-- celular (bpos.com.mx/evidencia/<token>), toma la foto y se sube a
-- bpos-media/<negocio>/evidencias. Solo el servidor (llave de servicio) lee
-- y escribe esta tabla: el celular no tiene sesión del negocio.
-- =============================================================

create table if not exists public.bpos_task_evidence (
  token        text primary key,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  branch_id    uuid,
  title        text not null default '',
  photo_url    text,
  created_at   timestamptz not null default now(),
  uploaded_at  timestamptz
);

alter table public.bpos_task_evidence enable row level security;

create index if not exists bpos_task_evidence_created_idx on public.bpos_task_evidence (created_at);
