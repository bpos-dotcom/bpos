#!/usr/bin/env bash
# Compila y publica la versión aparte "bpos-nube" (nube de Cloudflare, con la
# marca de agua "Versión Cloudflare"). No toca el Worker "bpos" de producción.
set -euo pipefail
cd "$(dirname "$0")/.."
CFG=wrangler.nube.jsonc
ORIGIN="https://bpos-nube.maderorecords.workers.dev"
ANON=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(require("path").join(require("os").homedir(),".bpos","nube-secretos.json"),"utf8")).NUBE_ANON_KEY || "")')
[ ${#ANON} -ge 20 ] || { echo "Falta NUBE_ANON_KEY en ~/.bpos/nube-secretos.json"; exit 1; }

export NEXT_PUBLIC_SUPABASE_URL="$ORIGIN/sb"
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$ANON"
export NEXT_PUBLIC_BPOS_NUBE="cloudflare"
export NEXT_PUBLIC_BPOS_SERVER="$ORIGIN"
export BPOS_BUILD_SHA="$(git rev-parse HEAD)"

npx opennextjs-cloudflare build -c "$CFG"
# Revisa que las pantallas sí quedaron con la llave de la nube (no la de Supabase)
grep -rqF "$ANON" .open-next/assets/_next/static || { echo "La compilación no tiene la llave de la nube: no se publica"; exit 1; }
npx opennextjs-cloudflare deploy -c "$CFG"
echo "Publicado en $ORIGIN"
