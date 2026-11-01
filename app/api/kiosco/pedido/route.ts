import { NextResponse, type NextRequest } from "next/server";
import { KioskError, cancelKioskOrder, createKioskOrder, kioskConfigured, kioskFromRequest, kioskOrderStatus, retryKioskOrder } from "@/lib/kiosk/server";

/**
 * Pedido del kiosco (siempre con la llave de la pantalla en x-kiosk-token).
 *   POST   { lines, eat, name?, club? }   guarda el pedido (club = teléfono del socio) y enciende la terminal
 *   GET    ?id=<pedido>            cómo va el cobro: esperando · pagado · fallo
 *   PATCH  { id }                  reintentar el cobro (otra orden a la terminal)
 *   DELETE ?id=<pedido>            el cliente canceló: se cancela en la terminal y se borra
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const fail = (error: unknown) =>
  error instanceof KioskError
    ? NextResponse.json({ success: false, error: error.message }, { status: error.status })
    : NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Mercado Pago no respondió." }, { status: 502 });

async function kiosk(request: NextRequest) {
  if (!kioskConfigured()) throw new KioskError("El kiosco no está disponible.", 503);
  return kioskFromRequest(request);
}

export async function POST(request: NextRequest) {
  try {
    const k = await kiosk(request);
    const body = (await request.json().catch(() => ({}))) as { lines?: unknown; eat?: unknown; name?: unknown; club?: unknown };
    return NextResponse.json({ success: true, ...(await createKioskOrder(k, body)) });
  } catch (error) {
    return fail(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const k = await kiosk(request);
    return NextResponse.json({ success: true, ...(await kioskOrderStatus(k, request.nextUrl.searchParams.get("id") || "")) });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const k = await kiosk(request);
    const body = (await request.json().catch(() => ({}))) as { id?: unknown };
    return NextResponse.json({ success: true, ...(await retryKioskOrder(k, String(body.id || ""))) });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const k = await kiosk(request);
    await cancelKioskOrder(k, request.nextUrl.searchParams.get("id") || "");
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error);
  }
}
