import type { NextRequest } from "next/server";
import { aiPreflight, aiReply } from "@/lib/ai/cloud";
import { menuPaymentRefund } from "@/lib/mp/menu-payments";
import { memberSession } from "@/lib/mp/merchant";

/** Pedidos en línea → Rechazar un pedido pagado con Mercado Pago: le devuelve su dinero al cliente. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(request: NextRequest) {
  return aiPreflight(request);
}

export async function POST(request: NextRequest) {
  const session = await memberSession(request);
  if ("error" in session) return session.error;
  const body = (await request.json().catch(() => ({}))) as { id?: string };
  try {
    const mp = await menuPaymentRefund(session.businessId, String(body.id || ""));
    return aiReply(request, { success: true, mp });
  } catch (error) {
    return aiReply(request, { success: false, error: error instanceof Error ? error.message : "No se pudo devolver el pago." }, 502);
  }
}
