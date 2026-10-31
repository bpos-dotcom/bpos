/**
 * Bloque 15 · IA de B-POS desde la nube (corre en Vercel).
 *
 * Las claves de IA de la plataforma viven solo en el servidor: las que el
 * dueño pone en Configuración → Administrador (cifradas, lib/ai/settings.ts)
 * o ANTHROPIC_API_KEY de Vercel. Nunca van en los instaladores. Cada caja llama aquí con
 * la sesión de su negocio; antes de gastar se revisa:
 *  - que el negocio tenga plan Max activo (o en prueba);
 *  - que no haya pasado su presupuesto de IA del mes (no se le muestra).
 * Después de cada consulta se suma lo que costó (bpos_ai_charge, 0006).
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/client";
import { getAiConfig, type AiConfig, type AiFeature } from "@/lib/ai/settings";
import { aiCost, type AiUsage } from "@/lib/ai/engine";

// Las cajas llaman desde http://localhost:3000; la sesión va en el encabezado (sin cookies)
function cors(request: NextRequest) {
  return {
    "Access-Control-Allow-Origin": request.headers.get("origin") || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function aiReply(request: NextRequest, body: object, status = 200) {
  return NextResponse.json(body, { status, headers: cors(request) });
}

export function aiPreflight(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(request) });
}

export type AiAllowance = { plan: string; status: string; active: boolean; budget: number; spent: number };

type AiSession = { supabase: SupabaseClient; businessId: string; userId: string; ai: AiConfig | null; allowance: AiAllowance };

/**
 * Sesión para usar IA, o la respuesta de error. `check`: false solo consulta
 * el estado (para mostrar si el plan la incluye) sin exigir llave.
 */
export async function aiSession(request: NextRequest, check = true, feature: AiFeature = "interprete"): Promise<{ error: NextResponse } | AiSession> {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return { error: aiReply(request, { success: false, error: "Inicia sesión con la cuenta del negocio." }, 401) };

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: user, error } = await supabase.auth.getUser(token);
  if (error || !user.user) return { error: aiReply(request, { success: false, error: "Sesión no válida." }, 401) };

  const { data: member } = await supabase.from("business_members").select("business_id").eq("user_id", user.user.id).limit(1);
  const businessId = member?.[0]?.business_id as string | undefined;
  if (!businessId) return { error: aiReply(request, { success: false, error: "Tu cuenta no tiene negocio." }, 403) };

  const { data: allowance, error: allowanceError } = await supabase.rpc("bpos_ai_allowance", { p_business_id: businessId });
  if (allowanceError || !allowance) return { error: aiReply(request, { success: false, error: "No se pudo revisar el plan del negocio." }, 503) };
  const a = { ...(allowance as AiAllowance), budget: Number((allowance as AiAllowance).budget) || 0, spent: Number((allowance as AiAllowance).spent) || 0 };

  if (check) {
    if (a.plan !== "max") return { error: aiReply(request, { success: false, code: "plan", error: "Las funciones con IA vienen en el plan Max." }, 402) };
    if (!a.active) return { error: aiReply(request, { success: false, code: "inactive", error: "Tu plan no está activo. Revisa tu suscripción en Configuración → Mi plan." }, 402) };
    // El presupuesto en dólares no se le muestra al negocio
    if (a.spent >= a.budget) return { error: aiReply(request, { success: false, code: "limit", error: "Ya usaste las funciones con IA de este mes. Vuelven a estar disponibles el próximo mes." }, 429) };
  }

  const ai = check ? await getAiConfig(feature) : null;
  if (check && !ai) return { error: aiReply(request, { success: false, error: "La IA no está disponible por ahora. Intenta más tarde." }, 503) };
  return { supabase, businessId, userId: user.user.id, ai, allowance: a };
}

/** Suma lo que costó una consulta al gasto del mes del negocio. */
export async function chargeAi(session: AiSession, usage: AiUsage) {
  if (!session.ai) return;
  const cost = aiCost(session.ai, usage);
  const { error } = await session.supabase.rpc("bpos_ai_charge", { p_business_id: session.businessId, p_cost: cost });
  if (error) console.error("[B-POS] No se pudo registrar el uso de IA:", error.message);
}
