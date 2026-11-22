# Mudanza a Cloudflare (dejar Supabase)

Meta: B-POS funciona solo con Cloudflare (Workers $5: D1, R2, Durable Objects),
sin pagar Supabase. Supabase queda de respaldo (plan gratis) para regresar en
minutos si algo falla.

## Idea central: una "nube" compatible con Supabase dentro del Worker

B-POS (pantallas, API y Agent) habla con Supabase usando `@supabase/supabase-js`
y llamadas HTTP (`/rest/v1`, `/auth/v1`, `/realtime/v1`, `/storage/v1`). En vez
de reescribir ~60 archivos, el Worker contesta **esas mismas direcciones** bajo
`/sb/*`, guardando en D1/R2:

| Supabase | Cloudflare | Dónde |
|---|---|---|
| Postgres (tablas + RLS) | D1 (SQLite) + reglas de acceso en TS | `nube/rest.ts`, `nube/tables.ts`, `nube/access.ts` |
| Funciones plpgsql (RPC) | Funciones TS | `nube/rpc/*.ts` |
| Triggers | Pasos en las escrituras | `nube/triggers.ts` |
| Auth (GoTrue) | Usuarios en D1, JWT HS256, mismas contraseñas (bcrypt) | `nube/auth.ts` |
| Realtime (Phoenix) | Durable Object con el mismo protocolo | `nube/realtime.ts`, `nube/worker.ts` |
| Storage | R2 | `nube/storage.ts` |
| Respaldos de 10 MB | R2 (D1 guarda una marca) | `BLOB_COLUMNS` en `nube/rest.ts` |

Cambiar de una nube a la otra = cambiar `NEXT_PUBLIC_SUPABASE_URL` al compilar
(`https://<dominio>/sb`). El código de B-POS no cambia. El Agent pregunta a
`/api/nube` a dónde hablar (con Supabase como respaldo si no contesta).

`custom-worker.ts` manda `/sb/*` a `nube/worker.ts` antes de OpenNext, **solo si
el Worker tiene la base D1** (el Worker de producción de hoy no cambia).

Sesiones: las cajas que ya tenían sesión de Supabase siguen entrando; al
renovar se les da una de la nube (`legacy` en `nube/auth.ts`). Nadie vuelve a
escribir su contraseña.

## Versión aparte (para probar sin tocar la caja)

Worker `bpos-nube` (https://bpos-nube.maderorecords.workers.dev) con su propia
D1, compilado con la marca de agua "Versión Cloudflare" (`wrangler.nube.jsonc`).

## Fases

1. [x] Esquema exacto de Supabase → `nube/tables.ts` → `nube/schema.sql`
2. [x] REST compatible (select con embebidos, filtros, orden, límites, conteo, upsert)
3. [x] Auth compatible (password, refresh, user, signup, logout, admin)
4. [x] RPC usadas por la web (23) y por el Agent (6) + triggers (revisadas contra las de producción)
5. [x] Realtime (sync_heads y aviso al Agent) + Storage en R2 + respaldos grandes en R2
6. [x] Marca de agua + `/api/nube` + Agent pregunta a dónde hablar (falta publicar Agent nuevo)
7. [ ] Conectar la cuenta de Cloudflare (`npx wrangler login`, lo aprueba el dueño)
8. [ ] `scripts/nube-crear.sh` (D1, R2, tablas, secretos) y el dueño pone `SOURCE_SUPABASE_SERVICE_KEY`
9. [ ] Aplicar migración 0046 en Supabase (exportar usuarios, solo servidor)
10. [ ] `scripts/nube-publicar.sh` y `npx tsx scripts/nube-copiar.ts https://bpos-nube.maderorecords.workers.dev`
11. [ ] Pruebas completas en la versión aparte (caja, cocina, menú, kiosco, Bridge, club, pagos, Agent)
12. [ ] Agent nuevo publicado (pregunta /api/nube) antes de la noche del cambio
13. [ ] Noche del cambio (restaurante cerrado): copiar datos otra vez, compilar producción con la nube, revisar
14. [ ] Regreso a Supabase si hace falta: compilar con la URL vieja (y copiar de regreso lo nuevo)

## Lo que necesita el dueño

- Aprobar `npx wrangler login` (abre Cloudflare en el navegador → Permitir).
- Pegar la llave de servidor de Supabase en Cloudflare:
  `npx wrangler secret put SOURCE_SUPABASE_SERVICE_KEY -c wrangler.nube.jsonc`
  (Supabase → Project Settings → API Keys → secret / service_role).
- Elegir la noche del cambio.

## Notas

- En el mismo proyecto de Supabase vive otra app (tablas `fin_*`, FinancIA) y
  una vista `bpos_movimientos_caja` que lee `sync_records`. Esa app no se muda;
  si se deja Supabase gratis, sigue funcionando ahí.
- Los secretos de la nube están en `~/.bpos/nube-secretos.json` (fuera de git).

## Pruebas

`scripts/test-nube-rest.ts` (51), `test-nube-rpc.ts` (53), `test-nube-realtime.ts`
(19), `test-nube-mudanza.ts` (14): supabase-js contra la nube sobre SQLite.
`scripts/nube-local.ts`: la nube en esta computadora para abrir B-POS completo.
