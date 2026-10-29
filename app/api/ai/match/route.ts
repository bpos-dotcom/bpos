import { NextResponse, type NextRequest } from "next/server";
import { guardBridgeRequest } from "@/lib/bridge/api-guard";
import { friendlyAiError, readAnthropicKey } from "@/lib/ai/key-store";
import { matchLines, type CatalogProduct } from "@/lib/ai/match";

/**
 * Bridge → "🤖 Sugerir con IA" (ver lib/ai/match.ts).
 *   POST { lines: [...], platform, products: [{ id, name, category, price }] }
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const denied = await guardBridgeRequest(request);
  if (denied) return denied;

  const key = readAnthropicKey();
  if (!key) return NextResponse.json({ success: false, error: "Primero guarda tu llave de Anthropic en Configuración → Subir menú con IA." }, { status: 400 });

  let lines: string[] = [];
  let platform = "";
  let products: CatalogProduct[] = [];
  try {
    const body = await request.json();
    lines = (Array.isArray(body?.lines) ? body.lines : []).map((l: unknown) => String(l || "").trim()).filter(Boolean).slice(0, 40);
    platform = String(body?.platform || "").slice(0, 40);
    products = (Array.isArray(body?.products) ? body.products : [])
      .map((p: CatalogProduct) => ({ id: Number(p.id), name: String(p.name || ""), category: String(p.category || ""), price: Number(p.price) || 0 }))
      .filter((p: CatalogProduct) => p.id && p.name)
      .slice(0, 600);
  } catch {
    return NextResponse.json({ success: false, error: "Petición inválida." }, { status: 400 });
  }
  if (!lines.length) return NextResponse.json({ success: false, error: "No hay renglones para revisar." }, { status: 400 });
  if (!products.length) return NextResponse.json({ success: false, error: "No hay productos en el catálogo." }, { status: 400 });

  try {
    const matches = await matchLines(key, lines, platform, products);
    if (matches === "refusal") return NextResponse.json({ success: false, error: "Claude no pudo revisar estos renglones." }, { status: 422 });
    if (!matches) return NextResponse.json({ success: false, error: "Claude no regresó sugerencias. Intenta de nuevo." }, { status: 502 });
    return NextResponse.json({ success: true, matches });
  } catch (error) {
    return NextResponse.json({ success: false, error: friendlyAiError(error) }, { status: 502 });
  }
}
