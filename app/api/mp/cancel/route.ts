import type { NextRequest } from "next/server";
import { aiPreflight, aiReply } from "@/lib/ai/cloud";
import { applyPreapproval, cancelPreapproval } from "@/lib/billing/mercadopago";
import { ownerSession } from "@/lib/billing/session";

/** Mi plan → Cancelar suscripción (sigue funcionando hasta lo ya pagado). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(request: NextRequest) {
  return aiPreflight(request);
}

export async function POST(request: NextRequest) {
  const session = await ownerSession(request);
  if ("error" in session) return session.error;
  const id = session.business.mp_preapproval_id;
  if (!id) return aiReply(request, { success: false, error: "No tienes una suscripción de Mercado Pago." }, 400);
  try {
    const pre = await cancelPreapproval(id);
    await applyPreapproval(pre);
    return aiReply(request, { success: true, status: pre.status });
  } catch (error) {
    return aiReply(request, { success: false, error: error instanceof Error ? error.message : "No se pudo cancelar." }, 502);
  }
}
