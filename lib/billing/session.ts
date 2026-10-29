/**
 * Sesión del dueño del negocio para las rutas de cobro (corre en Vercel).
 * Solo el dueño (rol owner) puede contratar o cancelar el plan.
 */
import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/client";
import { aiReply } from "@/lib/ai/cloud";
import { billingConfigured } from "@/lib/billing/mercadopago";

export async function ownerSession(request: NextRequest) {
  if (!billingConfigured()) return { error: aiReply(request, { success: false, error: "El cobro en línea todavía no está disponible. Escríbenos para activar tu plan." }, 503) };
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return { error: aiReply(request, { success: false, error: "Inicia sesión con la cuenta del negocio." }, 401) };

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: user, error } = await supabase.auth.getUser(token);
  if (error || !user.user) return { error: aiReply(request, { success: false, error: "Sesión no válida." }, 401) };

  const { data: member } = await supabase.from("business_members").select("business_id, role").eq("user_id", user.user.id).limit(1);
  const row = member?.[0];
  if (!row) return { error: aiReply(request, { success: false, error: "Tu cuenta no tiene negocio." }, 403) };
  if (row.role !== "owner") return { error: aiReply(request, { success: false, error: "Solo la cuenta dueña del negocio puede cambiar el plan." }, 403) };

  const { data: business } = await supabase.from("businesses").select("id, name, plan, plan_status, mp_preapproval_id").eq("id", row.business_id).maybeSingle();
  if (!business) return { error: aiReply(request, { success: false, error: "No se encontró el negocio." }, 404) };
  return { supabase, email: user.user.email || "", business: business as { id: string; name: string; plan: string; plan_status: string; mp_preapproval_id: string | null } };
}
