import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { aiPreflight, aiReply } from "@/lib/ai/cloud";
import { supabaseAdmin } from "@/lib/billing/mercadopago";
import { authorizationUrl, memberSession } from "@/lib/mp/merchant";

/**
 * Configuración → Métodos de pago → Mercado Pago del negocio.
 *   GET    ?branch=<id>  ¿está vinculado? (cuenta y terminal de la sucursal)
 *   POST                 liga para vincular (solo la cuenta dueña)
 *   DELETE               desvincular (solo la cuenta dueña)
 * Las llaves de Mercado Pago nunca se mandan al navegador.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(request: NextRequest) {
  return aiPreflight(request);
}

export async function GET(request: NextRequest) {
  const session = await memberSession(request);
  if ("error" in session) return session.error;
  const db = supabaseAdmin();
  const { data: account } = await db.from("bpos_mp_accounts").select("nickname, linked_at, live_mode").eq("business_id", session.businessId).maybeSingle();
  const branch = request.nextUrl.searchParams.get("branch") || "";
  let terminal: string | null = null;
  if (account && session.branchIds.includes(branch)) {
    const { data } = await db.from("bpos_mp_terminals").select("terminal_id").eq("branch_id", branch).maybeSingle();
    terminal = data?.terminal_id || null;
  }
  return aiReply(request, {
    success: true,
    linked: Boolean(account),
    nickname: account?.nickname || "",
    linkedAt: account?.linked_at || null,
    terminal,
    canLink: session.role === "owner",
  });
}

export async function POST(request: NextRequest) {
  const session = await memberSession(request, { owner: true });
  if ("error" in session) return session.error;
  const state = randomBytes(24).toString("hex");
  const db = supabaseAdmin();
  await db.from("bpos_mp_link_states").delete().lt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  const { error } = await db.from("bpos_mp_link_states").insert({ state, business_id: session.businessId, user_id: session.userId });
  if (error) return aiReply(request, { success: false, error: "No se pudo empezar la vinculación." }, 500);
  return aiReply(request, { success: true, url: authorizationUrl(state) });
}

export async function DELETE(request: NextRequest) {
  const session = await memberSession(request, { owner: true });
  if ("error" in session) return session.error;
  const db = supabaseAdmin();
  await db.from("bpos_mp_terminals").delete().eq("business_id", session.businessId);
  await db.from("bpos_mp_accounts").delete().eq("business_id", session.businessId);
  return aiReply(request, { success: true });
}
