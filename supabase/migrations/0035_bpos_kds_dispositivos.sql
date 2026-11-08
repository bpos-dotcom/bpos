-- =============================================================
-- Tablets de cocina (bpos.com.mx/kds/<liga>)
--
-- Igual que los celulares de meseros (0026): se vinculan una vez con un
-- código de 6 dígitos de Configuración → Tablets de cocina y quedan como
-- cuenta de dispositivo del negocio. Se guardan en las mismas tablas con
-- su tipo: un código de cocina no vincula un celular de mesero ni al revés.
-- =============================================================

alter table public.bpos_waiter_devices add column if not exists kind text not null default 'mesero';
alter table public.bpos_waiter_codes add column if not exists kind text not null default 'mesero';

create index if not exists bpos_waiter_devices_branch_kind_idx on public.bpos_waiter_devices (branch_id, kind);
