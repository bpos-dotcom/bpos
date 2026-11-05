import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { aiPreflight, aiReply } from "@/lib/ai/cloud";
import { supabaseAdmin } from "@/lib/billing/mercadopago";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/client";

/**
 * Club → regalo de bienvenida (producto gratis), desde la caja con la sesión del negocio:
 *   POST { accountId, product, order, by } → lo deja en el historial del socio (canje en ceros con
 *   ref "regalo-bienvenida"). El índice único (socio, tipo, ref) hace que solo se dé una vez.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(request: NextRequest) {
  return aiPreflight(request);
}

async function businessSession(request: NextRequest) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: user } = await supabase.auth.getUser(token);
  if (!user.user) return null;
  const { data: member } = await supabase.from("business_members").select("business_id").eq("user_id", user.user.id).limit(1);
  return member?.[0] ? { businessId: member[0].business_id as string } : null;
}

export async function POST(request: NextRequest) {
  const session = await businessSession(request);
  if (!session) return aiReply(request, { ok: false, error: "Inicia sesión en B-POS." }, 401);
  const body = (await request.json().catch(() => ({}))) as { accountId?: string; product?: string; order?: string; by?: string };
  const accountId = String(body.accountId || "");
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) return aiReply(request, { ok: false, error: "Socio inválido." }, 400);
  const db = supabaseAdmin();
  const { data: m } = await db.from("bpos_loyalty_members").select("business_id").eq("account_id", accountId).maybeSingle();
  if (!m || m.business_id !== session.businessId) return aiReply(request, { ok: false, error: "Socio no encontrado." }, 404);
  const { error } = await db.from("bpos_loyalty_movements").insert({
    business_id: session.businessId,
    account_id: accountId,
    kind: "canje",
    ref: "regalo-bienvenida",
    note: `Regalo de bienvenida: ${String(body.product || "producto").slice(0, 60)}${body.order ? ` · ${String(body.order).slice(0, 30)}` : ""}`.slice(0, 120),
    created_by: String(body.by || "").slice(0, 60),
  });
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return aiReply(request, { ok: false, error: "Este socio ya recibió su regalo de bienvenida." }, 409);
    return aiReply(request, { ok: false, error: error.message }, 500);
  }
  return aiReply(request, { ok: true });
}
