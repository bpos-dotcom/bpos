import { NextResponse, type NextRequest } from "next/server";
import { KioskError, kioskConfigured, kioskFromRequest, kioskStatus, pairKiosk } from "@/lib/kiosk/server";

/**
 * La pantalla del kiosco (bpos.com.mx/kiosco), sin cuenta de B-POS.
 *   POST { email, code, name? }   vincular la pantalla → { token, slug, business, branch, kioskId, name }
 *   GET  (x-kiosk-token)          estado: liga del menú, si puede cobrar, datos del negocio
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (error: unknown) =>
  error instanceof KioskError
    ? NextResponse.json({ success: false, error: error.message }, { status: error.status })
    : NextResponse.json({ success: false, error: error instanceof Error ? error.message : "No se pudo." }, { status: 502 });

export async function POST(request: NextRequest) {
  if (!kioskConfigured()) return NextResponse.json({ success: false, error: "El kiosco no está disponible." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { email?: unknown; code?: unknown; name?: unknown };
  try {
    const session = await pairKiosk(body.email, body.code, body.name);
    return NextResponse.json({ success: true, ...session });
  } catch (error) {
    return fail(error);
  }
}

export async function GET(request: NextRequest) {
  if (!kioskConfigured()) return NextResponse.json({ success: false, error: "El kiosco no está disponible." }, { status: 503 });
  try {
    const kiosk = await kioskFromRequest(request);
    return NextResponse.json({ success: true, ...(await kioskStatus(kiosk)) });
  } catch (error) {
    return fail(error);
  }
}
