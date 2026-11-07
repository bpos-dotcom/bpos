import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/client";
import { supabaseAdmin } from "@/lib/billing/mercadopago";
import { serviceCatalog } from "@/lib/services-server";
import { isServiceId } from "@/lib/services";

/**
 * Administrador de B-POS → Servicios (solo el dueño de la plataforma):
 *   GET                                                        → catálogo y cuántos negocios tienen cada servicio
 *   POST { service, price, trialDays, aiBudgetUsd, active }    → guarda precio, días de prueba, presupuesto de IA y si se vende
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reply = (body: object, status = 200) => NextResponse.json(body, { status });

async function requireAdmin(request: NextRequest) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const [{ data: user }, { data: isAdmin }] = await Promise.all([db.auth.getUser(token), db.rpc("is_platform_admin")]);
  return user.user && isAdmin === true ? user.user.email || user.user.id : null;
}

async function list() {
  const [catalog, { data: rows }] = await Promise.all([serviceCatalog(), supabaseAdmin().from("bpos_services").select("service, status, trial_ends_at, paid_until")]);
  const now = Date.now();
  const count = (service: string, status: string) =>
    (rows || []).filter((r) => r.service === service && r.status === status && (status === "active" ? !r.paid_until || Date.parse(r.paid_until) > now : status === "trial" ? r.trial_ends_at && Date.parse(r.trial_ends_at) > now : true)).length;
  return { catalog: catalog.map((c) => ({ ...c, trials: count(c.service, "trial"), paying: count(c.service, "active") })) };
}

export async function GET(request: NextRequest) {
  if (!(await requireAdmin(request))) return reply({ error: "Solo para el administrador de B-POS." }, 403);
  try {
    return reply(await list());
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : "No se pudo leer." }, 500);
  }
}

export async function POST(request: NextRequest) {
  const who = await requireAdmin(request);
  if (!who) return reply({ error: "Solo para el administrador de B-POS." }, 403);
  const body = (await request.json().catch(() => ({}))) as { service?: string; price?: unknown; trialDays?: unknown; aiBudgetUsd?: unknown; active?: unknown };
  if (!isServiceId(body.service)) return reply({ error: "Servicio desconocido." }, 400);
  const num = (v: unknown, min: number, max: number) => Math.min(max, Math.max(min, Number(v) || 0));
  const { error } = await supabaseAdmin()
    .from("bpos_service_catalog")
    .upsert({
      service: body.service,
      price: Math.round(num(body.price, 0, 100000) * 100) / 100,
      trial_days: Math.round(num(body.trialDays, 0, 90)),
      ai_budget_usd: Math.round(num(body.aiBudgetUsd, 0, 1000) * 100) / 100,
      active: body.active !== false,
      updated_by: who,
      updated_at: new Date().toISOString(),
    });
  if (error) return reply({ error: error.message }, 500);
  return reply(await list());
}
