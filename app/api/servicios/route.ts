import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/client";
import { aiPreflight, aiReply } from "@/lib/ai/cloud";
import { billingConfigured, supabaseAdmin } from "@/lib/billing/mercadopago";
import { businessServices, cancelService, serviceCatalog, startTrial, subscribeService, syncServicePayment } from "@/lib/services-server";
import { isServiceId, SERVICE_IDS, type ServiceId } from "@/lib/services";

/**
 * Servicios por separado (bpos.com.mx/servicios), con la sesión del negocio:
 *   POST { accion: "estado" }                         → tipo de cuenta, catálogo y servicios del negocio
 *   POST { accion: "tipo", servicios? }               → la cuenta queda como "solo servicios" (y empieza sus pruebas)
 *   POST { accion: "probar", servicio }               → prueba gratis (una vez por servicio)
 *   POST { accion: "contratar", servicio, email }     → liga de pago mensual de Mercado Pago
 *   POST { accion: "revisar", servicio, preapproval? } → al volver de Mercado Pago, revisa el pago
 *   POST { accion: "cancelar", servicio }             → cancela (sigue hasta lo ya pagado)
 * Solo la cuenta dueña del negocio cambia algo; los demás solo consultan.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(request: NextRequest) {
  return aiPreflight(request);
}

async function session(request: NextRequest) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: user } = await db.auth.getUser(token);
  if (!user.user) return null;
  const { data: member } = await db.from("business_members").select("business_id, role").eq("user_id", user.user.id).order("created_at", { ascending: true }).limit(1);
  const row = member?.[0];
  if (!row) return null;
  const { data: business } = await supabaseAdmin().from("businesses").select("id, name, account_kind").eq("id", row.business_id).maybeSingle();
  if (!business) return null;
  return { email: user.user.email || "", owner: row.role === "owner", business: business as { id: string; name: string; account_kind: string } };
}

async function state(businessId: string, kind: string) {
  const [catalog, services] = await Promise.all([serviceCatalog(), businessServices(businessId)]);
  return { success: true, kind, catalog, services: services.map(({ mp_preapproval_id: _id, ...r }) => (void _id, r)), billing: billingConfigured() };
}

export async function POST(request: NextRequest) {
  const s = await session(request);
  if (!s) return aiReply(request, { success: false, error: "Inicia sesión con la cuenta del negocio." }, 401);
  const body = (await request.json().catch(() => ({}))) as { accion?: string; servicio?: string; servicios?: unknown; email?: string; preapproval?: string };
  const accion = String(body.accion || "estado");
  const service = isServiceId(body.servicio) ? (body.servicio as ServiceId) : null;

  try {
    if (accion === "estado") return aiReply(request, await state(s.business.id, s.business.account_kind));
    if (!s.owner) return aiReply(request, { success: false, error: "Solo la cuenta dueña del negocio puede cambiar sus servicios." }, 403);

    if (accion === "tipo") {
      const { error } = await supabaseAdmin().from("businesses").update({ account_kind: "servicios" }).eq("id", s.business.id);
      if (error) throw new Error(error.message);
      // Pruebas de lo que eligió al crear la cuenta (el kiosco va después del menú)
      const wanted = (Array.isArray(body.servicios) ? body.servicios : []).filter(isServiceId) as ServiceId[];
      const ordered = SERVICE_IDS.filter((id) => wanted.includes(id));
      for (const id of ordered) await startTrial(s.business.id, id).catch(() => undefined);
      return aiReply(request, await state(s.business.id, "servicios"));
    }

    if (!service) return aiReply(request, { success: false, error: "Elige un servicio." }, 400);

    if (accion === "probar") {
      await startTrial(s.business.id, service);
      return aiReply(request, await state(s.business.id, s.business.account_kind));
    }
    if (accion === "contratar") {
      if (!billingConfigured()) return aiReply(request, { success: false, error: "El cobro en línea todavía no está disponible. Escríbenos para activar tu servicio." }, 503);
      const email = String(body.email || s.email).trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return aiReply(request, { success: false, error: "Escribe un correo válido para Mercado Pago." }, 400);
      const r = await subscribeService({ businessId: s.business.id, businessName: s.business.name, service, email });
      return aiReply(request, { success: true, ...r });
    }
    if (accion === "revisar") {
      if (billingConfigured()) await syncServicePayment(s.business.id, service, typeof body.preapproval === "string" ? body.preapproval : undefined);
      return aiReply(request, await state(s.business.id, s.business.account_kind));
    }
    if (accion === "cancelar") {
      await cancelService(s.business.id, service);
      return aiReply(request, await state(s.business.id, s.business.account_kind));
    }
    return aiReply(request, { success: false, error: "Acción no válida." }, 400);
  } catch (e) {
    return aiReply(request, { success: false, error: e instanceof Error ? e.message : "No se pudo." }, 400);
  }
}
