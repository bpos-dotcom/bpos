import { NextResponse, type NextRequest } from "next/server";
import { finishLink, merchantConfigured } from "@/lib/mp/merchant";
import { PUSH_SERVER as CLOUD_SERVER } from "@/lib/push/rules";

/**
 * Regreso de Mercado Pago después de que el dueño autoriza a B-POS.
 * Guarda las llaves del negocio y vuelve a Configuración → Métodos de pago.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const back = new URL("/configuracion/pagos", CLOUD_SERVER);
  const code = request.nextUrl.searchParams.get("code") || "";
  const state = request.nextUrl.searchParams.get("state") || "";
  if (!merchantConfigured() || !code || !state) {
    back.searchParams.set("mp", "error");
    back.searchParams.set("msg", request.nextUrl.searchParams.get("error_description") || "No se completó la vinculación.");
    return NextResponse.redirect(back);
  }
  try {
    await finishLink(code, state);
    back.searchParams.set("mp", "ok");
  } catch (error) {
    back.searchParams.set("mp", "error");
    back.searchParams.set("msg", error instanceof Error ? error.message : "No se pudo vincular.");
  }
  return NextResponse.redirect(back);
}
