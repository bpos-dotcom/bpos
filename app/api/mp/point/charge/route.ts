import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { aiPreflight, aiReply } from "@/lib/ai/cloud";
import { supabaseAdmin } from "@/lib/billing/mercadopago";
import { cancelPointOrder, createPointOrder, getPointOrder, memberSession, merchantToken } from "@/lib/mp/merchant";

/**
 * Cobro con la terminal Point de la sucursal (desde el POS, con tarjeta).
 *   POST   { branchId, amount, description }  manda el monto a la terminal
 *   GET    ?id=<orden>                         cómo va (processed = pagado)
 *   DELETE ?id=<orden>                         cancelar el cobro en la terminal
 * El resultado siempre se pregunta a Mercado Pago (no se confía en el navegador).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(request: NextRequest) {
  return aiPreflight(request);
}

const friendly = (error: unknown) => (error instanceof Error ? error.message : "Mercado Pago no respondió.");

async function chargeOf(businessId: string, id: string) {
  const { data } = await supabaseAdmin().from("bpos_mp_charges").select("*").eq("id", id).eq("business_id", businessId).maybeSingle();
  return data;
}

export async function POST(request: NextRequest) {
  const session = await memberSession(request);
  if ("error" in session) return session.error;
  const body = await request.json().catch(() => ({}));
  const branchId = String(body?.branchId || "");
  const amount = Math.round(Number(body?.amount) * 100) / 100;
  if (!session.branchIds.includes(branchId)) return aiReply(request, { success: false, error: "Sucursal no encontrada." }, 404);
  if (!(amount >= 1) || amount > 500000) return aiReply(request, { success: false, error: "Monto inválido." }, 400);
  try {
    const token = await merchantToken(session.businessId);
    if (!token) return aiReply(request, { success: false, error: "Vincula tu cuenta de Mercado Pago en Configuración → Métodos de pago." }, 409);
    const db = supabaseAdmin();
    const { data: terminal } = await db.from("bpos_mp_terminals").select("terminal_id").eq("branch_id", branchId).maybeSingle();
    if (!terminal) return aiReply(request, { success: false, error: "Elige la terminal de esta sucursal en Configuración → Métodos de pago." }, 409);
    const reference = `bpos-${randomBytes(8).toString("hex")}`;
    const order = await createPointOrder(token, terminal.terminal_id, amount, reference, String(body?.description || "Venta B-POS"));
    await db.from("bpos_mp_charges").insert({ id: order.id, business_id: session.businessId, branch_id: branchId, amount, reference, status: order.status });
    return aiReply(request, { success: true, id: order.id, status: order.status });
  } catch (error) {
    return aiReply(request, { success: false, error: friendly(error) }, 502);
  }
}

export async function GET(request: NextRequest) {
  const session = await memberSession(request);
  if ("error" in session) return session.error;
  const id = request.nextUrl.searchParams.get("id") || "";
  const charge = await chargeOf(session.businessId, id);
  if (!charge) return aiReply(request, { success: false, error: "Cobro no encontrado." }, 404);
  try {
    const token = await merchantToken(session.businessId);
    if (!token) return aiReply(request, { success: false, error: "La cuenta de Mercado Pago se desvinculó." }, 409);
    const order = await getPointOrder(token, id);
    const payment = order.transactions?.payments?.[0];
    if (order.status !== charge.status) await supabaseAdmin().from("bpos_mp_charges").update({ status: order.status, updated_at: new Date().toISOString() }).eq("id", id);
    return aiReply(request, { success: true, id, status: order.status, detail: payment?.status_detail || order.status_detail || "", paymentId: payment?.id || null, amount: Number(charge.amount) });
  } catch (error) {
    return aiReply(request, { success: false, error: friendly(error) }, 502);
  }
}

export async function DELETE(request: NextRequest) {
  const session = await memberSession(request);
  if ("error" in session) return session.error;
  const id = request.nextUrl.searchParams.get("id") || "";
  if (!(await chargeOf(session.businessId, id))) return aiReply(request, { success: false, error: "Cobro no encontrado." }, 404);
  try {
    const token = await merchantToken(session.businessId);
    if (!token) return aiReply(request, { success: false, error: "La cuenta de Mercado Pago se desvinculó." }, 409);
    const order = await cancelPointOrder(token, id);
    return aiReply(request, { success: true, status: order.status });
  } catch (error) {
    return aiReply(request, { success: false, error: friendly(error) }, 502);
  }
}
