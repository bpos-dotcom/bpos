import { NextResponse, type NextRequest } from "next/server";
import { menuPaymentNotice } from "@/lib/mp/menu-payments";
import { merchantConfigured } from "@/lib/mp/merchant";

/**
 * Avisos de Mercado Pago de los pagos del menú digital (la dirección va en
 * cada cobro: ?b=<negocio>). No se confía en el aviso: con su id se consulta
 * el pago en Mercado Pago con la llave de ese negocio.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!merchantConfigured()) return NextResponse.json({ ok: false }, { status: 503 });
  const url = request.nextUrl;
  let body: { type?: string; topic?: string; data?: { id?: string | number } } = {};
  try {
    body = await request.json();
  } catch {
    // algunos avisos llegan solo con parámetros en la dirección
  }
  const type = String(body.type || body.topic || url.searchParams.get("type") || url.searchParams.get("topic") || "");
  const id = String(body.data?.id || url.searchParams.get("data.id") || url.searchParams.get("id") || "");
  if (!type.includes("payment") || !id) return NextResponse.json({ ok: true, ignored: type || "sin id" });
  try {
    await menuPaymentNotice(url.searchParams.get("b") || "", id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[B-POS] Aviso de pago del menú:", error instanceof Error ? error.message : error);
    // 500 para que Mercado Pago lo vuelva a intentar
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
