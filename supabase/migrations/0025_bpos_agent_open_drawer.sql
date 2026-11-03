-- Trabajo 'open-drawer' para el Agent (abrir el cajón al abrir el cobro en
-- efectivo, Agent 2.0.8+). La restricción vieja solo dejaba los 4 tipos
-- originales y la pantalla de cobro no podía dejar el trabajo.
alter table public.bpos_agent_jobs drop constraint if exists bpos_agent_jobs_kind_check;
alter table public.bpos_agent_jobs
  add constraint bpos_agent_jobs_kind_check
  check (kind in ('print-tickets', 'print-original', 'station-printers', 'print', 'open-drawer'));
