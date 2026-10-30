import { NextResponse, type NextRequest } from "next/server";
import { applyPreapproval, billingConfigured, getAuthorizedPayment, getPreapproval } from "@/lib/billing/mercadopago";

/**
 * Avisos de Mercado Pago (Tus integraciones → Webhooks → evento "Planes y
 * suscripciones", URL https://www.bpos.com.mx/api/mp/webhook).
 * No se confía en el contenido del aviso: con su id se vuelve a consultar la
 * suscripción en Mercado Pago y de ahí se actualiza el plan.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!billingConfigured()) return NextResponse.json({ ok: false }, { status: 503 });
  const url = new URL(request.url);
  let body: { type?: string; action?: string; data?: { id?: string | number } } = {};
  try {
    body = await request.json();
  } catch {
    // algunos avisos llegan solo con parámetros en la dirección
  }
  const type = String(body.type || url.searchParams.get("type") || url.searchParams.get("topic") || "");
  const id = String(body.data?.id || url.searchParams.get("data.id") || url.searchParams.get("id") || "");
  if (!id) return NextResponse.json({ ok: true, ignored: "sin id" });

  try {
    let preapprovalId = "";
    if (type.includes("authorized_payment")) preapprovalId = (await getAuthorizedPayment(id)).preapproval_id || "";
    else if (type.includes("preapproval")) preapprovalId = id;
    if (!preapprovalId) return NextResponse.json({ ok: true, ignored: type });
    const result = await applyPreapproval(await getPreapproval(preapprovalId));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[B-POS] Aviso de Mercado Pago:", error instanceof Error ? error.message : error);
    // 500 para que Mercado Pago lo vuelva a intentar
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
