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
3. Authentication → Sign In / Providers → Email: puedes apagar **Confirm email**
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
