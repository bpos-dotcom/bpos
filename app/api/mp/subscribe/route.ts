import type { NextRequest } from "next/server";
import { aiPreflight, aiReply } from "@/lib/ai/cloud";
import { createSubscription, supabaseAdmin } from "@/lib/billing/mercadopago";
import { ownerSession } from "@/lib/billing/session";
import { PLANS, type PlanId } from "@/lib/plans";

/**
 * Mi plan → Contratar: crea la suscripción mensual en Mercado Pago y
 * regresa la liga para pagar.
 *   POST { plan: "basic" | "pro" | "max", branches, email }
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(request: NextRequest) {
  return aiPreflight(request);
}

export async function POST(request: NextRequest) {
  const session = await ownerSession(request);
  if ("error" in session) return session.error;

  let plan: PlanId = "basic";
  let branches = 1;
  let email = session.email;
  try {
    const body = await request.json();
    plan = (body?.plan in PLANS ? body.plan : "basic") as PlanId;
    branches = Math.min(50, Math.max(1, Math.round(Number(body?.branches) || 1)));
    email = String(body?.email || session.email).trim();
  } catch {
    return aiReply(request, { success: false, error: "Petición inválida." }, 400);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return aiReply(request, { success: false, error: "Escribe un correo válido para Mercado Pago." }, 400);

  try {
    const pre = await createSubscription({ businessId: session.business.id, businessName: session.business.name, plan, branches, email });
    // Se guarda para poder revisar el pago al volver; si ya paga otro plan,
    // la suscripción actual se queda hasta que la nueva quede pagada.
    const keep = session.business.plan_status === "active" && session.business.mp_preapproval_id;
    await supabaseAdmin().from("businesses").update(keep ? { mp_payer_email: email } : { mp_preapproval_id: pre.id, mp_payer_email: email }).eq("id", session.business.id);
    return aiReply(request, { success: true, id: pre.id, url: pre.init_point, total: PLANS[plan].price * branches });
  } catch (error) {
    return aiReply(request, { success: false, error: error instanceof Error ? error.message : "No se pudo crear el cobro." }, 502);
  }
}
