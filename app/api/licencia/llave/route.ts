import { NextResponse } from "next/server";
import { licenseKeys } from "@/lib/license-server";

/** Llave pública para verificar los permisos (no es secreta) */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { publicKey } = await licenseKeys();
    return NextResponse.json({ success: true, publicKey }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "No se pudo." }, { status: 500 });
  }
}
