import { NextResponse, type NextRequest } from "next/server";
import { menuAcceptsMp, menuCheckout, menuPaymentCheck } from "@/lib/mp/menu-payments";
import { merchantConfigured } from "@/lib/mp/merchant";

/**
 * Pago en línea del menú digital (lo usa el cliente, sin cuenta de B-POS).
 *   GET  ?liga=<slug>                          ¿el negocio cobra con Mercado Pago?
 *   POST { action: "pagar", id, token }        liga de Mercado Pago para pagar el pedido
 *   POST { action: "revisar", id, token }      ¿ya se pagó? (al regresar de Mercado Pago)
 * El pedido se identifica con su id y la llave secreta de su liga de seguimiento.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("liga") || "";
  if (!merchantConfigured() || !slug) return NextResponse.json({ available: false });
  try {
    return NextResponse.json({ available: await menuAcceptsMp(slug) });
  } catch {
    return NextResponse.json({ available: false });
  }
}

export async function POST(request: NextRequest) {
  if (!merchantConfigured()) return NextResponse.json({ success: false, error: "El pago en línea no está disponible." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { action?: string; id?: string; token?: string };
  const id = String(body.id || "");
  const token = String(body.token || "");
  if (!id || !token) return NextResponse.json({ success: false, error: "Falta el pedido." }, { status: 400 });
  try {
    if (body.action === "pagar") return NextResponse.json({ success: true, url: await menuCheckout(id, token) });
    if (body.action === "revisar") return NextResponse.json({ success: true, mp: await menuPaymentCheck(id, token) });
    return NextResponse.json({ success: false, error: "Acción no válida." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Mercado Pago no respondió." }, { status: 502 });
  }
}
