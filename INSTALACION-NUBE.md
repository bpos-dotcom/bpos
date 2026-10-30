# B-POS en la nube (Supabase)

B-POS sigue guardando todo en el navegador como siempre, y ahora además
**lo sincroniza con Supabase**. Todas las computadoras, tablets y celulares
del negocio ven las mismas ventas, caja, cocina e inventario, y siguen
funcionando si se va el internet (los cambios se suben al volver).

Si el archivo `.env.local` no existe, B-POS funciona igual que antes (solo local).

## 1. En Supabase (una sola vez)

1. SQL Editor → New query → pega `supabase/migrations/0001_bpos_schema.sql` → Run.
   (Si ya lo corriste antes, sáltate este paso.)
2. SQL Editor → New query → pega `supabase/migrations/0002_bpos_sync.sql` → Run.
3. SQL Editor → New query → pega `supabase/migrations/0003_bpos_vistas.sql` → Run.
   Crea las tablas de consulta (`bpos_ventas`, `bpos_insumos`, `bpos_cortes_caja`, ...)
   que ves en Table Editor. Se puede correr más de una vez.
4. SQL Editor → New query → pega `supabase/migrations/0004_bpos_bitacora.sql` → Run.
   Bitácora en la nube que nadie puede editar ni borrar, y protección para que
   las ventas no se puedan borrar (solo cancelar con motivo).
5. SQL Editor → New query → pega `supabase/migrations/0005_bpos_push.sql` → Run.
   Guarda qué celulares reciben avisos push y cuáles ya se mandaron.
6. Authentication → URL Configuration: Site URL `https://www.bpos.com.mx`
   y en Redirect URLs `https://www.bpos.com.mx/**`, `https://bpos.com.mx/**`, `https://bpos-alpha.vercel.app/**` y `http://localhost:3000/**`.
7. Authentication → Sign In / Providers → Email: puedes apagar **Confirm email**
   para que la cuenta quede lista sin revisar el correo.

## 2. En la computadora de la caja

1. El archivo `.env.local` debe tener la URL y la llave *publishable* de Supabase.
2. En la carpeta del proyecto: `npm install` y luego `npm run dev`.
3. Abre http://localhost:3000 → **Crear cuenta** → **Crear negocio** →
   **Subir y continuar**. Esta computadora queda como **caja principal**.

## 3. En cada dispositivo extra (cocina, celular del dueño)

Abre B-POS, entra con **la misma cuenta** y listo: descarga todo solo.
Después cada empleado entra con su PIN como siempre.

## Cómo funciona

- `lib/cloud/sync.ts` sube a la tabla `sync_records` cada cambio de las
  llaves `bpos_*` y baja los cambios de los demás en tiempo real.
- `components/cloud/CloudGate.tsx` pide la cuenta del negocio la primera vez
  y muestra el indicador ☁️ abajo a la derecha (clic para ver opciones).
- Solo la **caja principal** descuenta inventario de las ventas, para que no
  se descuente dos veces.

## Límites conocidos (por ahora)

- Cobrar desde **una sola caja por sucursal**. Dos cajas cobrando al mismo
  tiempo podrían repetir el número de pedido.
- Las rutas `/api/bridge/*` leen archivos de la computadora; al publicar en
  Vercel eso se tendrá que mover a la nube (bloque 13).

## Seguridad del Bridge

- `/api/bridge/*` solo responde a pantallas con sesión en la cuenta del negocio
  y a B-POS Agent de esta computadora.
- El Agent se identifica con la llave que B-POS crea en `%USERPROFILE%/.bpos/agent-key`.
  El Agent instalado hoy todavía no la manda: se sigue aceptando solo para
  entregar pedidos. Cuando reinstales el Agent nuevo, agrega
  `BPOS_REQUIRE_AGENT_KEY=1` a `.env.local` para cerrar esa puerta.

## App del dueño (bloque 12)

En el celular del dueño abre B-POS en `/dueno`, entra con la cuenta del
negocio y con tu PIN, y luego instálala como app:

- **Android (Chrome):** botón **📲 Instalar B-POS** dentro de la app, o menú ⋮ → *Instalar app*.
- **iPhone (Safari):** botón **Compartir** → *Agregar a pantalla de inicio*.

Muestra ventas de todas las sucursales (se actualiza cada 30 s), utilidad y
margen, productos top y alertas críticas. Con **🔔 Activar notificaciones**
avisa de ventas nuevas y alertas críticas mientras la app esté abierta o en
segundo plano, y también con la app **cerrada** (avisos push).

### B-POS en Vercel y avisos push

- B-POS está publicado en **https://www.bpos.com.mx** (dominio en Neubox con nameservers de Vercel; también responde bpos-alpha.vercel.app; proyecto `bpos`
  en Vercel, conectado a GitHub: cada cambio en `main` se publica solo).
- Los avisos push salen de Vercel. Necesita la variable
  **VAPID_PRIVATE_KEY** en Vercel → Settings → Environment Variables (el valor
  está en `.env.local` de la computadora donde se creó; **nunca** va a GitHub).
  La llave pública está en `lib/push/rules.ts`.
- La caja sube cada evento a la bitácora de la nube y luego le pide a Vercel
  que avise. Vercel lee el evento de la bitácora (no confía en lo que mande la
  caja) y no repite avisos.
- Se avisa de: pedidos de delivery, ventas grandes (monto ajustable) o todas,
  cancelaciones, cortes de caja (con faltante o sobrante) y cambios de
  seguridad. Cada celular elige los suyos en la App del dueño.
- En iPhone los avisos push solo funcionan con B-POS instalado en la pantalla
  de inicio (iOS 16.4 o más nuevo).
