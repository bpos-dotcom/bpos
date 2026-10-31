import type { NextRequest } from "next/server";
import { z } from "zod";
import { aiPreflight, aiReply, aiSession, chargeAi } from "@/lib/ai/cloud";
import { AiFailure, generateJson, generateText, type AiTurn } from "@/lib/ai/engine";

/**
 * App del dueño → Asesor con IA (solo plan Max, con la clave y el modelo que
 * el administrador eligió para "asesor").
 *   POST { action: "analizar", metrics }          → resumen, alertas y consejos de la semana
 *   POST { action: "preguntar", metrics, turns }  → respuesta del chat
 * `metrics` son los números que arma la App del dueño (ventas, platillos,
 * horas, gastos...). El asesor solo usa esos números.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const AnalysisSchema = z.object({
  resumen: z.string(),
  alertas: z.array(z.object({ titulo: z.string(), texto: z.string() })),
  consejos: z.array(z.object({ titulo: z.string(), texto: z.string() })),
});
export type AdvisorAnalysis = z.infer<typeof AnalysisSchema>;

const SYSTEM = `Eres el asesor de negocios de un restaurante en México, dentro de B-POS (su punto de venta).
Hablas con el dueño en español de México, claro y directo, como un consultor que conoce restaurantes.
Usa SOLO los números que vienen en los datos; no inventes cifras. Si falta un dato (por ejemplo gastos fijos o recetas con costo), dilo y explica cómo afecta la conclusión.
Da recomendaciones concretas y accionables para esta semana: promociones para días u horas flojas, precios a revisar según margen y food cost, platillos a impulsar o quitar, personal en horas pico, ahorro en gastos.
Cantidades en pesos con formato $12,345. No des asesoría fiscal ni legal: para eso, que consulte a su contador.`;

const ANALYZE = `Con estos datos, escribe:
- resumen: un párrafo (3 a 5 frases) de cómo va la semana contra la anterior: ventas, pedidos, ticket promedio, utilidad y punto de equilibrio si hay datos.
- alertas: de 2 a 4 problemas o riesgos que veas en los números (título corto y explicación de 1 a 2 frases con cifras).
- consejos: de 2 a 4 acciones para esta semana (título corto y qué hacer, con cifras).`;

export function OPTIONS(request: NextRequest) {
  return aiPreflight(request);
}

export async function POST(request: NextRequest) {
  const session = await aiSession(request, true, "asesor");
  if ("error" in session) return session.error;

  let action = "";
  let metrics = "";
  let turns: AiTurn[] = [];
  try {
    const body = await request.json();
    action = String(body?.action || "");
    metrics = JSON.stringify(body?.metrics ?? {}).slice(0, 30_000);
    turns = (Array.isArray(body?.turns) ? body.turns : [])
      .slice(-12)
      .map((t: { role?: string; text?: string }) => ({ role: t.role === "assistant" ? "assistant" : "user", text: String(t.text || "").slice(0, 2000) }))
      .filter((t: AiTurn) => t.text.trim());
  } catch {
    return aiReply(request, { success: false, error: "Petición inválida." }, 400);
  }

  try {
    if (action === "analizar") {
      const r = await generateJson(session.ai!, {
        system: SYSTEM,
        schema: AnalysisSchema,
        maxTokens: 6000,
        effort: "medium",
        parts: [{ type: "text", text: `Datos del restaurante (JSON):\n${metrics}\n\n${ANALYZE}` }],
      });
      await chargeAi(session, r.usage);
      if (!r.data) return aiReply(request, { success: false, error: "El asesor no pudo armar el análisis. Intenta de nuevo." }, 502);
      return aiReply(request, { success: true, analysis: r.data });
    }

    if (action === "preguntar") {
      if (!turns.length || turns[turns.length - 1].role !== "user") return aiReply(request, { success: false, error: "Escribe tu pregunta." }, 400);
      const r = await generateText(session.ai!, {
        system: `${SYSTEM}\n\nResponde en máximo 6 frases o una lista corta. Datos del restaurante (JSON):\n${metrics}`,
        turns,
        maxTokens: 1500,
      });
      await chargeAi(session, r.usage);
      return aiReply(request, { success: true, text: r.text });
    }
    return aiReply(request, { success: false, error: "Acción desconocida." }, 400);
  } catch (error) {
    return aiReply(request, { success: false, error: error instanceof AiFailure ? error.message : "Error con la IA." }, error instanceof AiFailure ? error.status : 502);
  }
}
