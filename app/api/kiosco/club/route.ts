import { NextResponse, type NextRequest } from "next/server";
import { KioskError, findClubMember, kioskClub, kioskConfigured, kioskFromRequest } from "@/lib/kiosk/server";

/**
 * Club de clientes en el kiosco (con la llave de la pantalla en x-kiosk-token).
 *   GET            → { club: { name, kind } | null }       el club del negocio, si está encendido
 *   GET ?phone=…   → { club, member: { name, member } | null }  busca al socio por su teléfono
 * Nunca regresa datos internos del cliente: solo su nombre, para saludarlo.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!kioskConfigured()) return NextResponse.json({ success: false, error: "El kiosco no está disponible." }, { status: 503 });
  try {
    const kiosk = await kioskFromRequest(request);
    const club = await kioskClub(kiosk);
    const phone = request.nextUrl.searchParams.get("phone");
    if (!phone) return NextResponse.json({ success: true, club });
    const found = club ? await findClubMember(kiosk, phone) : null;
    return NextResponse.json({ success: true, club, member: found ? { name: found.name, member: found.member } : null });
  } catch (error) {
    return error instanceof KioskError
      ? NextResponse.json({ success: false, error: error.message }, { status: error.status })
      : NextResponse.json({ success: false, error: error instanceof Error ? error.message : "No se pudo." }, { status: 502 });
  }
}
