import { NextResponse, type NextRequest } from "next/server";
import { bridgeAuth } from "@/lib/bridge/api-guard";
import { bridgeStore } from "@/lib/bridge/store";

/**
 * Huella del Bridge (pedidos y equivalencias): unos cuantos bytes. El menú
 * lateral y la página del Bridge la revisan cada 2-3 s y solo bajan los
 * pedidos y equivalencias completos cuando cambia (ahorra tráfico de Supabase).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await bridgeAuth(request);
  if ("denied" in auth) return auth.denied;
  try {
    const version = await bridgeStore(auth.ctx).version();
    return NextResponse.json({ success: true, version }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "No se pudo." }, { status: 502 });
  }
}
