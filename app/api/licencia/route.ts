import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/billing/mercadopago";
import { issueLicense } from "@/lib/license-server";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/client";

/**
 * Permiso de uso firmado (lib/license-server.ts).
 *   POST con Authorization: Bearer <sesión del negocio>   → permiso de ese negocio (B-POS en el navegador)
 *   POST { agentToken }                                   → permiso del negocio de ese B-POS Agent
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { agentToken?: string };
    let businessId = "";

    if (body.agentToken) {
      const hash = createHash("sha256").update(String(body.agentToken)).digest("hex");
      const { data: agent } = await supabaseAdmin().from("bpos_agents").select("business_id").eq("token_hash", hash).is("revoked_at", null).maybeSingle();
      if (!agent) return reply({ success: false, error: "Agent desvinculado." }, 401);
      businessId = agent.business_id;
    } else {
      const auth = request.headers.get("authorization") || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (!token) return reply({ success: false, error: "Sin sesión." }, 401);
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
      const { data: user } = await supabase.auth.getUser(token);
      if (!user.user) return reply({ success: false, error: "Sesión no válida." }, 401);
      const { data: member } = await supabase.from("business_members").select("business_id").eq("user_id", user.user.id).limit(1);
      if (!member?.[0]) return reply({ success: false, error: "Tu cuenta no tiene negocio." }, 403);
      businessId = member[0].business_id;
    }

    const license = await issueLicense(businessId);
    return reply({ success: true, ...license });
  } catch (error) {
    return reply({ success: false, error: error instanceof Error ? error.message : "No se pudo." }, 500);
  }
}
