"use client";
/**
 * Llamadas a la IA de B-POS en la nube (Vercel, lib/ai/cloud.ts) con la
 * sesión del negocio. La llave de Anthropic nunca está en esta computadora.
 */
import { getSupabase } from "@/lib/supabase/client";

export type AiStatus = { plan: string; active: boolean; available: boolean; reason: "plan" | "inactive" | "limit" | null };

async function token() {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token || "";
}

export async function aiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const t = await token();
  if (t) headers.set("Authorization", `Bearer ${t}`);
  if (init.body) headers.set("Content-Type", "application/json");
  return fetch(path, { ...init, headers });
}

/** Estado de la IA del negocio, o null si no se pudo consultar. */
export async function getAiStatus(): Promise<AiStatus | null> {
  try {
    const r = await aiFetch("/api/ai/status", { cache: "no-store" });
    const b = await r.json();
    return r.ok && b.success ? (b as AiStatus) : null;
  } catch {
    return null;
  }
}

export const AI_REASON_TEXT: Record<string, string> = {
  plan: "Las funciones con IA vienen en el plan Max.",
  inactive: "Tu plan no está activo. Revísalo en Configuración → Mi plan.",
  limit: "Ya usaste las funciones con IA de este mes. Vuelven el próximo mes.",
};
