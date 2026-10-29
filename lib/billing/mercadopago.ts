/**
 * Bloque 15 · Cobro mensual con Mercado Pago (suscripciones / preapproval).
 * Corre solo en Vercel. Necesita en Vercel → Environment Variables:
 *   MP_ACCESS_TOKEN            Access Token de producción de Mercado Pago
 *   SUPABASE_SERVICE_ROLE_KEY  para activar el plan del negocio (el dueño no puede)
 *
 * Flujo: Mi plan → /api/mp/subscribe crea la suscripción y regresa la liga de
 * pago → el negocio paga en Mercado Pago → /api/mp/webhook (o /api/mp/sync al
 * volver) consulta la suscripción en Mercado Pago y activa el plan. Nunca se
 * confía en lo que diga la notificación: siempre se vuelve a preguntar a
 * Mercado Pago con el token.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/supabase/client";
import { PLANS, type PlanId } from "@/lib/plans";
import { PUSH_SERVER as CLOUD_SERVER } from "@/lib/push/rules";

const MP_API = "https://api.mercadopago.com";
const GRACE_DAYS = 3; // días extra después de la fecha de cobro antes de bloquear

export type Preapproval = {
  id: string;
  status: "pending" | "authorized" | "paused" | "cancelled" | string;
  payer_email?: string;
  external_reference?: string;
  next_payment_date?: string;
  init_point?: string;
  auto_recurring?: { transaction_amount?: number };
};

export function billingConfigured() {
  return Boolean(process.env.MP_ACCESS_TOKEN && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Cliente con permisos de servidor: el único que puede cambiar el plan de un negocio. */
export function supabaseAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || "", { auth: { persistSession: false, autoRefreshToken: false } });
}

async function mp<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${MP_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Mercado Pago (${response.status}): ${body.message || body.error || "error"}`);
  return body as T;
}

/** external_reference: "negocio|plan|sucursales" */
export function referenceFor(businessId: string, plan: PlanId, branches: number) {
  return `${businessId}|${plan}|${branches}`;
}

export function parseReference(ref?: string) {
  const [businessId, plan, branches] = String(ref || "").split("|");
  return { businessId, plan: (plan in PLANS ? plan : "basic") as PlanId, branches: Math.max(1, Number(branches) || 1) };
}

/** Crea la suscripción mensual y regresa la liga de pago de Mercado Pago. */
export async function createSubscription(opts: { businessId: string; businessName: string; plan: PlanId; branches: number; email: string }) {
  const plan = PLANS[opts.plan];
  return mp<Preapproval>("/preapproval", {
    method: "POST",
    body: JSON.stringify({
      reason: `B-POS ${plan.name} · ${opts.businessName} · ${opts.branches} sucursal(es)`,
      external_reference: referenceFor(opts.businessId, opts.plan, opts.branches),
      payer_email: opts.email,
      auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: plan.price * opts.branches, currency_id: "MXN" },
      back_url: `${CLOUD_SERVER}/configuracion/plan?pago=listo`,
      status: "pending",
    }),
  });
}

export const getPreapproval = (id: string) => mp<Preapproval>(`/preapproval/${encodeURIComponent(id)}`);
export const cancelPreapproval = (id: string) => mp<Preapproval>(`/preapproval/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ status: "cancelled" }) });
export const getAuthorizedPayment = (id: string) => mp<{ preapproval_id?: string }>(`/authorized_payments/${encodeURIComponent(id)}`);

/**
 * Pasa el estado de la suscripción de Mercado Pago al negocio:
 * autorizada → plan activo hasta la siguiente fecha de cobro (+3 días) y, si
 * era un cambio de plan, se cancela la suscripción anterior (no paga doble);
 * pausada → pago pendiente; cancelada → cancelado (sigue hasta lo ya pagado).
 * Los avisos de una suscripción que ya no es la del negocio se ignoran.
 */
export async function applyPreapproval(pre: Preapproval) {
  const { businessId, plan, branches } = parseReference(pre.external_reference);
  if (!businessId) throw new Error("La suscripción no trae el negocio.");
  const admin = supabaseAdmin();
  const { data: current } = await admin.from("businesses").select("mp_preapproval_id").eq("id", businessId).maybeSingle();
  const previous = (current?.mp_preapproval_id as string | null) || null;
  const isCurrent = !previous || previous === pre.id;

  const update: Record<string, unknown> = {};
  if (pre.status === "authorized") {
    const next = pre.next_payment_date ? new Date(pre.next_payment_date) : new Date(Date.now() + 30 * 86_400_000);
    Object.assign(update, {
      mp_preapproval_id: pre.id,
      mp_payer_email: pre.payer_email || null,
      plan,
      branches_paid: branches,
      plan_status: "active",
      paid_until: new Date(next.getTime() + GRACE_DAYS * 86_400_000).toISOString(),
    });
    if (!isCurrent) await cancelPreapproval(previous!).catch(() => undefined);
  } else if (!isCurrent) {
    return { businessId, status: pre.status, ignored: true };
  } else if (pre.status === "paused") {
    update.plan_status = "past_due";
  } else if (pre.status === "cancelled") {
    update.plan_status = "cancelled";
  } else {
    return { businessId, status: pre.status };
  }
  const { error } = await admin.from("businesses").update(update).eq("id", businessId);
  if (error) throw new Error(error.message);
  return { businessId, status: pre.status };
}
