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
| Postgres (tablas + RLS) | D1 (SQLite) + reglas de acceso en TS | `nube/rest.ts`, `nube/schema.ts`, `nube/access.ts` |
| Funciones plpgsql (RPC) | Funciones TS | `nube/rpc/*.ts` |
| Triggers | Pasos en las escrituras | `nube/triggers.ts` |
| Auth (GoTrue) | Usuarios en D1, JWT HS256, mismas contraseñas (bcrypt) | `nube/auth.ts` |
| Realtime (Phoenix) | Durable Object con el mismo protocolo | `nube/realtime.ts` |
| Storage | R2 | `nube/storage.ts` |

Cambiar de una nube a la otra = cambiar `NEXT_PUBLIC_SUPABASE_URL` al compilar
(`https://<dominio>/sb`). El código de B-POS no cambia. El Agent pregunta a
`/api/nube` a dónde hablar (con Supabase como respaldo si no contesta).

`custom-worker.ts` manda `/sb/*` a `nube/worker.ts` antes de OpenNext.

## Versión aparte (para probar sin tocar la caja)

Worker `bpos-nube` (bpos-nube.<cuenta>.workers.dev) con su propia D1, compilado
con `NEXT_PUBLIC_SUPABASE_URL=<su dirección>/sb` y `NEXT_PUBLIC_BPOS_NUBE=cloudflare`
→ marca de agua "Versión Cloudflare" arriba a la derecha. Se llena con una copia
de los datos de Supabase.

## Fases

1. [ ] Esquema exacto de Supabase (information_schema) → `nube/schema.sql` (D1)
2. [ ] REST compatible (select con embebidos, filtros, orden, límites, conteo, upsert)
3. [ ] Auth compatible (password, refresh, user, signup, logout, admin)
4. [ ] RPC usadas por la web (23) y por el Agent (6) + triggers
5. [ ] Realtime (sync_heads y aviso al Agent) + Storage en R2
6. [ ] Marca de agua + `/api/nube` + Agent nuevo que pregunta a dónde hablar
7. [ ] Copiar datos Supabase → D1 (script) y Worker `bpos-nube` para probar
8. [ ] Pruebas completas en la versión aparte (caja, cocina, menú, kiosco, Bridge, club, pagos)
9. [ ] Noche del cambio (con el restaurante cerrado): copiar datos, cambiar, revisar
10. [ ] Regreso a Supabase en minutos si hace falta: copiar D1 → Supabase y compilar con la URL vieja

## Lo que necesita el usuario

- Autorizar a `wrangler` en su cuenta de Cloudflare (crear D1, R2, el Worker `bpos-nube`).
- Elegir la noche del cambio.

## Pruebas

`scripts/test-nube-*.ts` corren la nube contra SQLite de Node (`node:sqlite`)
con el mismo esquema que D1.
