import type { NextRequest } from "next/server";
import { aiPreflight, aiReply, aiSession } from "@/lib/ai/cloud";

/**
 * ¿Este negocio puede usar las funciones con IA ahora? (para las pantallas)
 * No dice cuánto presupuesto tiene ni cuánto lleva: solo si está disponible.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(request: NextRequest) {
  return aiPreflight(request);
}

export async function GET(request: NextRequest) {
  const session = await aiSession(request, false);
  if ("error" in session) return session.error;
  const a = session.allowance;
  const reason = a.plan !== "max" ? "plan" : !a.active ? "inactive" : a.spent >= a.budget ? "limit" : null;
  return aiReply(request, { success: true, plan: a.plan, active: a.active, available: !reason && Boolean(session.key), reason });
}
