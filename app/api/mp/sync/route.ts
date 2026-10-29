import type { NextRequest } from "next/server";
import { aiPreflight, aiReply } from "@/lib/ai/cloud";
import { applyPreapproval, getPreapproval, parseReference } from "@/lib/billing/mercadopago";
import { ownerSession } from "@/lib/billing/session";

/**
 * Mi plan, al volver de pagar: pregunta a Mercado Pago cómo está la
 * suscripción y actualiza el plan (por si el aviso de Mercado Pago tarda).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(request: NextRequest) {
  return aiPreflight(request);
}

export async function POST(request: NextRequest) {
  const session = await ownerSession(request);
  if ("error" in session) return session.error;
  const body = await request.json().catch(() => ({}));
  const id = String(body?.id || session.business.mp_preapproval_id || "");
  if (!id) return aiReply(request, { success: true, status: null });
  try {
    const pre = await getPreapproval(id);
    if (parseReference(pre.external_reference).businessId !== session.business.id) return aiReply(request, { success: false, error: "Ese pago no es de tu negocio." }, 403);
    await applyPreapproval(pre);
    return aiReply(request, { success: true, status: pre.status });
  } catch (error) {
    return aiReply(request, { success: false, error: error instanceof Error ? error.message : "No se pudo revisar el pago." }, 502);
  }
}
