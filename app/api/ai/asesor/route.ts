import type { NextRequest } from "next/server";
import { ANALYZE, AnalysisSchema, SYSTEM } from "@/lib/ai/advisor";
import { aiPreflight, aiReply, aiSession, chargeAi } from "@/lib/ai/cloud";
import { AiFailure, generateJson, generateText, type AiTurn } from "@/lib/ai/engine";
import { adminDb } from "@/lib/ai/settings";

/**
 * App del dueño → Asesor con IA (solo plan Max, con la clave y el modelo que
 * el administrador eligió para "asesor").
 *   POST { action: "analizar", metrics }          → resumen, alertas y consejos de la semana
 *   POST { action: "preguntar", metrics, turns }  → respuesta del chat
 *   POST { action: "estado" }                      → ¿resumen por correo cada lunes?
 *   POST { action: "correo", enabled }             → lo activa (al correo de quien entra) o lo apaga
 *   POST { action: "datos", metrics }              → números del día para el correo del lunes
 * `metrics` son los números que arma la App del dueño (ventas, platillos,
 * horas, gastos...). El asesor solo usa esos números.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export function OPTIONS(request: NextRequest) {
  return aiPreflight(request);
}

export async function POST(request: NextRequest) {
  let action = "";
  let enabled = false;
  let metrics = "";
  let turns: AiTurn[] = [];
  try {
    const body = await request.json();
    action = String(body?.action || "");
    enabled = body?.enabled === true;
    metrics = JSON.stringify(body?.metrics ?? {}).slice(0, 30_000);
    turns = (Array.isArray(body?.turns) ? body.turns : [])
      .slice(-12)
      .map((t: { role?: string; text?: string }) => ({ role: t.role === "assistant" ? "assistant" : "user", text: String(t.text || "").slice(0, 2000) }))
      .filter((t: AiTurn) => t.text.trim());
  } catch {
    return aiReply(request, { success: false, error: "Petición inválida." }, 400);
  }

  // Ajustes del correo y números del día: sin gastar IA (no exigen clave)
  const settings = action === "estado" || action === "correo" || action === "datos";
  const session = await aiSession(request, !settings, "asesor");
  if ("error" in session) return session.error;

  if (settings) {
    try {
      const db = adminDb();
      if (action === "correo") {
        if (enabled && session.allowance.plan !== "max") return aiReply(request, { success: false, error: "El Asesor con IA viene en el plan Max." }, 402);
        const { error } = await db
          .from("bpos_advisor_weekly")
          .upsert({ business_id: session.businessId, enabled, ...(enabled ? { email: session.email } : {}), updated_at: new Date().toISOString() });
        if (error) throw new Error(error.message);
      }
      if (action === "datos") {
        const { data: row } = await db.from("bpos_advisor_weekly").select("enabled").eq("business_id", session.businessId).maybeSingle();
        if (row?.enabled) await db.from("bpos_advisor_weekly").update({ metrics: JSON.parse(metrics), metrics_at: new Date().toISOString() }).eq("business_id", session.businessId);
      }
      const { data } = await db.from("bpos_advisor_weekly").select("enabled, email, last_week").eq("business_id", session.businessId).maybeSingle();
      return aiReply(request, { success: true, enabled: Boolean(data?.enabled), email: data?.email || session.email, lastWeek: data?.last_week || "" });
    } catch (e) {
      return aiReply(request, { success: false, error: e instanceof Error ? e.message : "No se pudo." }, 500);
    }
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
