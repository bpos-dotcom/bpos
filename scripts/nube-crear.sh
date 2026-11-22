#!/usr/bin/env bash
# Crea en Cloudflare lo de la versión aparte (una sola vez):
#   base D1 "bpos-nube", archivos R2 "bpos-nube-archivos", tablas y secretos.
# Necesita `npx wrangler login` hecho por el dueño de la cuenta.
# Los secretos salen de ~/.bpos/nube-secretos.json (nunca de git).
set -euo pipefail
cd "$(dirname "$0")/.."
CFG=wrangler.nube.jsonc

if grep -q '"database_id": "PENDIENTE"' "$CFG"; then
  echo "== Creando la base D1 bpos-nube"
  OUT=$(npx wrangler d1 create bpos-nube 2>&1 || true)
  echo "$OUT"
  ID=$(echo "$OUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  if [ -z "$ID" ]; then
    ID=$(npx wrangler d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const l=JSON.parse(s);const d=l.find(x=>x.name==="bpos-nube");process.stdout.write(d?d.uuid:"")})')
  fi
  [ -n "$ID" ] || { echo "No se pudo saber el id de la base"; exit 1; }
  node -e 'const fs=require("fs");const f=process.argv[1];fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace("\"database_id\": \"PENDIENTE\"",`"database_id": "${process.argv[2]}"`))' "$CFG" "$ID"
  echo "Base creada: $ID"
fi

echo "== Archivos R2 bpos-nube-archivos"
npx wrangler r2 bucket create bpos-nube-archivos 2>&1 | tail -2 || true

echo "== Tablas"
npx tsx scripts/nube-esquema.ts
npx wrangler d1 execute bpos-nube --remote --file nube/schema.sql -c "$CFG" -y

echo "== Secretos de la nube"
for NAME in NUBE_ANON_KEY NUBE_JWT_SECRET SUPABASE_SERVICE_ROLE_KEY MUDANZA_KEY; do
  VALUE=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(require("path").join(require("os").homedir(),".bpos","nube-secretos.json"),"utf8"))[process.argv[1]] || "")' "$NAME")
  # Un secreto vacío dejaría la nube sin funcionar: mejor parar aquí
  [ ${#VALUE} -ge 20 ] || { echo "  $NAME vacío o muy corto en nube-secretos.json"; exit 1; }
  printf '%s' "$VALUE" | npx wrangler secret put "$NAME" -c "$CFG" >/dev/null
  echo "  $NAME listo"
done
echo
echo "Falta un secreto que solo el dueño puede poner (la llave de servidor de Supabase, para copiar los datos):"
echo "  npx wrangler secret put SOURCE_SUPABASE_SERVICE_KEY -c $CFG"
