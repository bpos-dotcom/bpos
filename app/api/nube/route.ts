import { NextResponse } from "next/server";
import { NUBE_KIND } from "@/components/layout/NubeBadge";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/client";

/**
 * A qué nube habla esta versión de B-POS (Supabase o la de Cloudflare). Lo
 * pregunta B-POS Agent cada 10 minutos: así, al cambiar de nube (o regresar),
 * los Agents se pasan solos sin instalar nada. Solo datos públicos.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { url: SUPABASE_URL, key: SUPABASE_KEY, kind: NUBE_KIND },
    { headers: { "cache-control": "no-store" } }
  );
}
