import type { NextRequest } from "next/server";
import { friendlyAiError } from "@/lib/ai/key-store";
import { aiPreflight, aiReply, aiSession, chargeAi } from "@/lib/ai/cloud";
import { matchLines, type CatalogProduct } from "@/lib/ai/match";

/**
 * Bridge → "🤖 Sugerir con IA" (ver lib/ai/match.ts).
 *   POST { lines: [...], platform, products: [{ id, name, category, price }] }
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export function OPTIONS(request: NextRequest) {
  return aiPreflight(request);
}

export async function POST(request: NextRequest) {
  // En la nube con la llave de la plataforma: solo plan Max y dentro del presupuesto del mes
  const session = await aiSession(request);
  if ("error" in session) return session.error;
  const { key } = session;

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
    return aiReply(request, { success: false, error: "Petición inválida." }, 400);
  }
  if (!lines.length) return aiReply(request, { success: false, error: "No hay renglones para revisar." }, 400);
  if (!products.length) return aiReply(request, { success: false, error: "No hay productos en el catálogo." }, 400);

  try {
    const { matches, usage } = await matchLines(key, lines, platform, products);
    if (usage) await chargeAi(session, usage);
    if (matches === "refusal") return aiReply(request, { success: false, error: "Claude no pudo revisar estos renglones." }, 422);
    if (!matches) return aiReply(request, { success: false, error: "Claude no regresó sugerencias. Intenta de nuevo." }, 502);
    return aiReply(request, { success: true, matches });
  } catch (error) {
    return aiReply(request, { success: false, error: friendlyAiError(error) }, 502);
  }
}
