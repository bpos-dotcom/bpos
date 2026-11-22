#!/usr/bin/env bash
# Compila y publica la versión aparte "bpos-nube" (nube de Cloudflare, con la
# marca de agua "Versión Cloudflare"). No toca el Worker "bpos" de producción.
set -euo pipefail
cd "$(dirname "$0")/.."
CFG=wrangler.nube.jsonc
ORIGIN="https://bpos-nube.maderorecords.workers.dev"
ANON=$(node -e 'process.stdout.write(require(require("os").homedir()+"/.bpos/nube-secretos.json").NUBE_ANON_KEY)')

export NEXT_PUBLIC_SUPABASE_URL="$ORIGIN/sb"
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$ANON"
export NEXT_PUBLIC_BPOS_NUBE="cloudflare"
export NEXT_PUBLIC_BPOS_SERVER="$ORIGIN"
export BPOS_BUILD_SHA="$(git rev-parse HEAD)"

npx opennextjs-cloudflare build -c "$CFG"
npx opennextjs-cloudflare deploy -c "$CFG"
echo "Publicado en $ORIGIN"
