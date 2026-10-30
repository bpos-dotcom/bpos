import type { NextRequest } from "next/server";
import { aiPreflight, aiReply } from "@/lib/ai/cloud";
import { supabaseAdmin } from "@/lib/billing/mercadopago";
import { listTerminals, memberSession, merchantToken, setTerminalPdv } from "@/lib/mp/merchant";

/**
 * Terminal Point de la sucursal.
 *   GET    ?branch=<id>              terminales de la cuenta y la elegida
 *   POST   { branchId, terminalId }  usar esa terminal (la pone en modo PDV)
 *   DELETE { branchId }              dejar de cobrar con terminal
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(request: NextRequest) {
  return aiPreflight(request);
}

const friendly = (error: unknown) => (error instanceof Error ? error.message : "Mercado Pago no respondió.");

export async function GET(request: NextRequest) {
  const session = await memberSession(request);
  if ("error" in session) return session.error;
  const branch = request.nextUrl.searchParams.get("branch") || "";
  if (!session.branchIds.includes(branch)) return aiReply(request, { success: false, error: "Sucursal no encontrada." }, 404);
  try {
    const token = await merchantToken(session.businessId);
    if (!token) return aiReply(request, { success: false, error: "Primero vincula tu cuenta de Mercado Pago." }, 409);
    const terminals = await listTerminals(token);
    const { data } = await supabaseAdmin().from("bpos_mp_terminals").select("terminal_id").eq("branch_id", branch).maybeSingle();
    return aiReply(request, { success: true, terminals, selected: data?.terminal_id || null });
  } catch (error) {
    return aiReply(request, { success: false, error: friendly(error) }, 502);
  }
}

export async function POST(request: NextRequest) {
  const session = await memberSession(request, { owner: true });
  if ("error" in session) return session.error;
  const body = await request.json().catch(() => ({}));
  const branchId = String(body?.branchId || "");
  const terminalId = String(body?.terminalId || "").slice(0, 120);
  if (!session.branchIds.includes(branchId) || !terminalId) return aiReply(request, { success: false, error: "Elige la terminal." }, 400);
  try {
    const token = await merchantToken(session.businessId);
    if (!token) return aiReply(request, { success: false, error: "Primero vincula tu cuenta de Mercado Pago." }, 409);
    const terminals = await listTerminals(token);
    const terminal = terminals.find((t) => t.id === terminalId);
    if (!terminal) return aiReply(request, { success: false, error: "Esa terminal no está en tu cuenta de Mercado Pago." }, 404);
    if (terminal.operating_mode !== "PDV") await setTerminalPdv(token, terminalId);
    const { error } = await supabaseAdmin()
      .from("bpos_mp_terminals")
      .upsert({ branch_id: branchId, business_id: session.businessId, terminal_id: terminalId, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return aiReply(request, { success: true, terminal: terminalId, pdvChanged: terminal.operating_mode !== "PDV" });
  } catch (error) {
    return aiReply(request, { success: false, error: friendly(error) }, 502);
  }
}

export async function DELETE(request: NextRequest) {
  const session = await memberSession(request, { owner: true });
  if ("error" in session) return session.error;
  const body = await request.json().catch(() => ({}));
  const branchId = String(body?.branchId || "");
  if (!session.branchIds.includes(branchId)) return aiReply(request, { success: false, error: "Sucursal no encontrada." }, 404);
  await supabaseAdmin().from("bpos_mp_terminals").delete().eq("branch_id", branchId);
  return aiReply(request, { success: true });
}
