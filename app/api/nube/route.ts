import { NextResponse } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/client";

/**
 * A qué nube habla esta versión de B-POS (Supabase o la de Cloudflare). Lo
 * pregunta B-POS Agent cada 10 minutos: así, al cambiar de nube (o regresar),
 * los Agents se pasan solos sin instalar nada. Solo datos públicos.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { url: SUPABASE_URL, key: SUPABASE_KEY, kind: process.env.NEXT_PUBLIC_BPOS_NUBE === "cloudflare" ? "cloudflare" : "supabase" },
    { headers: { "cache-control": "no-store" } }
  );
}
