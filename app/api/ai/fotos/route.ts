import type { NextRequest } from "next/server";
import { aiPreflight, aiReply, aiSession, chargeAi } from "@/lib/ai/cloud";
import { AiFailure, editImage } from "@/lib/ai/engine";
import { getAiConfig, photoCredits, readAiRow } from "@/lib/ai/settings";
import { photoPrompt, creditsUsed, refundCredits, spendCredits, type PhotoBackground } from "@/lib/ai/photo-studio";
import { creditsKey, periodTexts } from "@/lib/ai/credits-period";

/**
 * Estudio de fotos con IA (plan Max):
 *   GET                                     → si está disponible, los BPOS Credits de hoy y si puede quitar el fondo
 *   POST { image, mediaType, background }   → la foto mejorada (base64); gasta los créditos de una foto
 * background: "conservar" (de fábrica, fondo difuminado) o "quitar" (PNG
 * transparente; solo OpenAI lo hace de verdad).
 * La foto no se guarda aquí: el dueño ve antes y después y, si la usa, se sube
 * como cualquier foto de producto (lib/media.ts).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// La caja reduce la foto antes de mandarla (~1600 px); esto es el tope de seguridad
const MAX_BASE64 = 6 * 1024 * 1024;

export function OPTIONS(request: NextRequest) {
  return aiPreflight(request);
}

/** BPOS Credits del periodo (día, semana o mes) del negocio */
async function creditsFor(businessId: string) {
  const { period, perPeriod, perUse } = photoCredits(await readAiRow("fotos"));
  const used = await creditsUsed(businessId, creditsKey(period));
  return { period, perPeriod, perUse, used, left: Math.max(0, perPeriod - used) };
}

export async function GET(request: NextRequest) {
  const session = await aiSession(request, false);
  if ("error" in session) return session.error;
  const a = session.allowance;
  try {
    const credits = await creditsFor(session.businessId);
    const cfg = await getAiConfig("fotos");
    const ready = Boolean(cfg);
    const reason = a.plan !== "max" ? "plan" : !a.active ? "inactive" : !ready ? "unavailable" : a.spent >= a.budget ? "limit" : null;
    return aiReply(request, { success: true, available: !reason, reason, credits, transparent: cfg?.provider === "openai" });
  } catch (e) {
    return aiReply(request, { success: false, error: e instanceof Error ? e.message : "No se pudo revisar el Estudio de fotos." }, 503);
  }
}

export async function POST(request: NextRequest) {
  const session = await aiSession(request, true, "fotos");
  if ("error" in session) return session.error;
  const body = (await request.json().catch(() => ({}))) as { image?: unknown; mediaType?: unknown; background?: unknown };
  const background: PhotoBackground = body.background === "quitar" ? "quitar" : "conservar";
  if (background === "quitar" && session.ai?.provider !== "openai") return aiReply(request, { success: false, error: "Quitar el fondo solo funciona con OpenAI. Usa Conservar fondo." }, 400);
  const data = typeof body.image === "string" ? body.image.replace(/^data:[^,]*,/, "") : "";
  const mediaType = typeof body.mediaType === "string" ? body.mediaType : "";
  if (!data || !/^image\/(jpeg|png|webp)$/.test(mediaType)) return aiReply(request, { success: false, error: "Sube una foto JPG, PNG o WEBP." }, 400);
  if (data.length > MAX_BASE64) return aiReply(request, { success: false, error: "La foto es muy grande. Usa una más pequeña." }, 413);

  let day = "";
  let charged = 0;
  try {
    const row = await readAiRow("fotos");
    const { period, perPeriod, perUse } = photoCredits(row);
    day = creditsKey(period);
    const used = await spendCredits(session.businessId, perUse, perPeriod, day);
    if (used === null) {
      const credits = await creditsFor(session.businessId);
      const t = periodTexts(period);
      return aiReply(request, { success: false, code: "credits", error: `Ya no te alcanzan los BPOS Credits de ${t.now} (cada foto usa ${perUse} y te quedan ${credits.left}). Se reinician ${t.reset}.`, credits }, 429);
    }
    charged = perUse;

    const r = await editImage(session.ai!, { prompt: photoPrompt(row, background), image: { mediaType, data }, transparent: background === "quitar" });
    await chargeAi(session, r.usage);
    if (!r.image) {
      await refundCredits(session.businessId, charged, day);
      charged = 0;
      const error = r.refusal ? "La IA no pudo editar esta foto. Prueba con otra foto del platillo." : "La IA no regresó ninguna foto. Intenta otra vez; no se gastaron créditos.";
      return aiReply(request, { success: false, error, credits: await creditsFor(session.businessId) }, 422);
    }
    return aiReply(request, { success: true, image: { mediaType: r.image.mimeType, data: r.image.data }, credits: { period, perPeriod, perUse, used, left: Math.max(0, perPeriod - used) } });
  } catch (e) {
    // Si la IA falló, los créditos se regresan
    if (charged && day) await refundCredits(session.businessId, charged, day);
    const status = e instanceof AiFailure ? e.status : 502;
    return aiReply(request, { success: false, error: e instanceof Error ? e.message : "No se pudo mejorar la foto." }, status);
  }
}
