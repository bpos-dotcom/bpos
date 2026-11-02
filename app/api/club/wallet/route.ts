import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { aiPreflight, aiReply } from "@/lib/ai/cloud";
import { supabaseAdmin } from "@/lib/billing/mercadopago";
import { WalletApiError, notifyWalletClass, syncWalletClass, syncWalletMember, walletReady, type WalletBusiness } from "@/lib/customer-accounts/wallet";
import { normalizeLoyalty } from "@/lib/loyalty";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/client";

/**
 * Tarjetas del club en Google Wallet, desde B-POS (con la sesión del negocio):
 *   POST { accion: "clase", config }            manda el diseño de la tarjeta a Google (al guardar Configuración → Club)
 *   POST { accion: "socio", accountId }          actualiza saldo y nombre en la tarjeta del socio (al sumar o canjear)
 *   POST { accion: "aviso", header, body }       notificación a todas las tarjetas del negocio (3 al día)
 *   GET                                          { ready, saved } cuántos socios tienen la tarjeta
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(request: NextRequest) {
  return aiPreflight(request);
}

async function businessSession(request: NextRequest) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: user } = await supabase.auth.getUser(token);
  if (!user.user) return null;
  const { data: member } = await supabase.from("business_members").select("business_id, role").eq("user_id", user.user.id).limit(1);
  const row = member?.[0];
  return row ? { businessId: row.business_id as string, role: row.role as string } : null;
}

/** Nombre, color, liga y configuración del club del negocio (lo sincronizado en la nube) */
async function walletBusiness(businessId: string, config?: unknown): Promise<WalletBusiness> {
  const db = supabaseAdmin();
  const [{ data: settings }, { data: link }, { data: club }] = await Promise.all([
    db.from("sync_records").select("data").eq("business_id", businessId).eq("scope", "business").eq("collection", "bpos_business_settings").eq("record_id", "__doc__").maybeSingle(),
    db.from("bpos_menu_links").select("slug").eq("business_id", businessId).order("created_at", { ascending: true }).limit(1).maybeSingle(),
    config === undefined
      ? db.from("sync_records").select("data").eq("business_id", businessId).eq("scope", "business").eq("collection", "bpos_loyalty").eq("record_id", "__doc__").maybeSingle()
      : Promise.resolve({ data: { data: config } }),
  ]);
  const s = (settings?.data || {}) as { businessName?: string; brandColor?: string };
  if (!link?.slug) throw new Error("Primero elige la liga de tu menú en Configuración → Menú digital.");
  return {
    businessId,
    businessName: s.businessName || "tu restaurante",
    slug: link.slug as string,
    color: /^#[0-9a-f]{6}$/i.test(s.brandColor || "") ? s.brandColor! : "#f97316",
    config: normalizeLoyalty(club?.data),
  };
}

export async function GET(request: NextRequest) {
  const session = await businessSession(request);
  if (!session) return aiReply(request, { success: false, error: "Inicia sesión con la cuenta del negocio." }, 401);
  const { count } = await supabaseAdmin().from("bpos_loyalty_members").select("account_id", { count: "exact", head: true }).eq("business_id", session.businessId).eq("wallet_saved", true);
  return aiReply(request, { success: true, ready: walletReady(), saved: count || 0 });
}

export async function POST(request: NextRequest) {
  const session = await businessSession(request);
  if (!session) return aiReply(request, { success: false, error: "Inicia sesión con la cuenta del negocio." }, 401);
  if (!walletReady()) return aiReply(request, { success: false, code: "setup", error: "Google Wallet todavía no está activado en B-POS." }, 503);
  const body = (await request.json().catch(() => ({}))) as { accion?: string; config?: unknown; accountId?: string; header?: string; body?: string };
  try {
    switch (body.accion) {
      case "clase": {
        const b = await walletBusiness(session.businessId, body.config);
        if (!b.config.enabled) return aiReply(request, { success: true, skipped: "El club está apagado." });
        const result = await syncWalletClass(b);
        return aiReply(request, { success: true, result });
      }
      case "socio": {
        const accountId = String(body.accountId || "");
        if (!accountId) return aiReply(request, { success: false, error: "Falta el socio." }, 400);
        const db = supabaseAdmin();
        const [{ data: member }, { data: acc }] = await Promise.all([
          db.from("bpos_loyalty_members").select("code, points, stamps, cashback, wallet_saved").eq("account_id", accountId).eq("business_id", session.businessId).maybeSingle(),
          db.from("bpos_customer_accounts").select("name").eq("id", accountId).eq("business_id", session.businessId).maybeSingle(),
        ]);
        if (!member || !acc) return aiReply(request, { success: true, synced: false });
        if (!member.wallet_saved) return aiReply(request, { success: true, synced: false });
        const b = await walletBusiness(session.businessId);
        const synced = await syncWalletMember(b, {
          accountId,
          customerName: String(acc.name || ""),
          code: String(member.code),
          points: Number(member.points),
          stamps: Number(member.stamps),
          cashback: Number(member.cashback),
        });
        return aiReply(request, { success: true, synced });
      }
      case "aviso": {
        const header = String(body.header || "").trim();
        const text = String(body.body || "").trim();
        if (header.length < 2 || text.length < 2) return aiReply(request, { success: false, error: "Escribe el título y el mensaje." }, 400);
        try {
          await notifyWalletClass(session.businessId, header, text);
        } catch (e) {
          if (e instanceof WalletApiError && e.status === 404) return aiReply(request, { success: false, error: "Todavía nadie ha agregado tu tarjeta a Google Wallet." }, 404);
          if (e instanceof WalletApiError && e.status === 429) return aiReply(request, { success: false, error: "Google solo permite 3 avisos al día. Inténtalo mañana." }, 429);
          throw e;
        }
        return aiReply(request, { success: true });
      }
      default:
        return aiReply(request, { success: false, error: "Acción no válida." }, 400);
    }
  } catch (e) {
    return aiReply(request, { success: false, error: e instanceof Error ? e.message : "No se pudo." }, 502);
  }
}
