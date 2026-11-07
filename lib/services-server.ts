/**
 * Servicios por separado en el servidor (Vercel): catálogo, prueba gratis,
 * cobro mensual con Mercado Pago y vigencia de cada servicio de un negocio
 * (bpos_service_catalog y bpos_services, 0034). Solo la llave de servicio
 * escribe; el dueño del negocio pide los cambios por /api/servicios.
 *
 * Mercado Pago: cada servicio es su propia suscripción (preapproval) con
 * external_reference "svc|negocio|servicio". Igual que los planes, nunca se
 * confía en el aviso: se vuelve a consultar la suscripción con el token.
 */
import { supabaseAdmin, getPreapproval, cancelPreapproval, type Preapproval } from "@/lib/billing/mercadopago";
import { PUSH_SERVER as CLOUD_SERVER } from "@/lib/push/rules";
import { mergeCatalog, parseServiceReference, serviceAccess, serviceInfo, serviceReference, type CatalogEntry, type ServiceId, type ServiceRow } from "@/lib/services";

const MP_API = "https://api.mercadopago.com";
const GRACE_DAYS = 3;
const DAY = 86_400_000;

export async function serviceCatalog(): Promise<CatalogEntry[]> {
  const { data } = await supabaseAdmin().from("bpos_service_catalog").select("service, price, trial_days, ai_budget_usd, active");
  return mergeCatalog((data || []) as Partial<CatalogEntry>[]);
}

export async function businessServices(businessId: string): Promise<(ServiceRow & { mp_preapproval_id: string | null })[]> {
  const { data, error } = await supabaseAdmin().from("bpos_services").select("service, status, trial_ends_at, paid_until, mp_preapproval_id").eq("business_id", businessId);
  if (error) throw new Error(error.message);
  return (data || []) as (ServiceRow & { mp_preapproval_id: string | null })[];
}

/** ¿El negocio tiene este servicio vigente? (y su fila del catálogo) */
export async function serviceOpen(businessId: string, service: ServiceId) {
  const [rows, catalog] = await Promise.all([businessServices(businessId).catch(() => []), serviceCatalog()]);
  const row = rows.find((r) => r.service === service);
  return { open: serviceAccess(row).open, entry: catalog.find((c) => c.service === service)! };
}

/** Prueba gratis de un servicio: una sola vez por negocio y servicio */
export async function startTrial(businessId: string, service: ServiceId) {
  const info = serviceInfo(service)!;
  const db = supabaseAdmin();
  const rows = await businessServices(businessId);
  if (rows.some((r) => r.service === service)) throw new Error(`Ya usaste la prueba de ${info.name}. Contrátalo para seguir.`);
  if (info.addonOf && !serviceAccess(rows.find((r) => r.service === info.addonOf)).open) throw new Error(`${info.name} es un extra de ${serviceInfo(info.addonOf)!.name}: primero activa ese servicio.`);
  const entry = (await serviceCatalog()).find((c) => c.service === service)!;
  if (!entry.active) throw new Error(`${info.name} no está disponible por ahora.`);
  const { error } = await db.from("bpos_services").insert({
    business_id: businessId,
    service,
    status: "trial",
    trial_ends_at: new Date(Date.now() + Math.max(0, entry.trial_days) * DAY).toISOString(),
  });
  if (error) throw new Error(error.message);
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

/** Suscripción mensual de un servicio; regresa la liga de pago */
export async function subscribeService(opts: { businessId: string; businessName: string; service: ServiceId; email: string }) {
  const info = serviceInfo(opts.service)!;
  const entry = (await serviceCatalog()).find((c) => c.service === opts.service)!;
  if (!entry.active) throw new Error(`${info.name} no está disponible por ahora.`);
  if (!(entry.price > 0)) throw new Error(`${info.name} todavía no tiene precio. Escríbenos para activarlo.`);
  const rows = await businessServices(opts.businessId);
  if (info.addonOf && !serviceAccess(rows.find((r) => r.service === info.addonOf)).open) throw new Error(`${info.name} es un extra de ${serviceInfo(info.addonOf)!.name}: primero activa ese servicio.`);
  const pre = await mp<Preapproval>("/preapproval", {
    method: "POST",
    body: JSON.stringify({
      reason: `B-POS ${info.name} · ${opts.businessName}`,
      external_reference: serviceReference(opts.businessId, opts.service),
      payer_email: opts.email,
      auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: entry.price, currency_id: "MXN" },
      back_url: `${CLOUD_SERVER}/servicios?pago=${opts.service}`,
      status: "pending",
    }),
  });
  // En prueba o vencido se recuerda para revisar el pago al volver; si ya está activo, la suscripción
  // actual sigue hasta que la nueva quede pagada. Sin fila todavía: al volver, Mercado Pago trae preapproval_id.
  const current = rows.find((r) => r.service === opts.service);
  if (current && current.status !== "active") {
    await supabaseAdmin().from("bpos_services").update({ mp_preapproval_id: pre.id, mp_payer_email: opts.email, updated_at: new Date().toISOString() }).eq("business_id", opts.businessId).eq("service", opts.service);
  }
  return { id: pre.id, url: pre.init_point, total: entry.price };
}

/**
 * Pasa el estado de la suscripción de Mercado Pago al servicio del negocio:
 * autorizada → activo hasta la siguiente fecha de cobro (+3 días); pausada →
 * pago pendiente; cancelada → cancelado (sigue hasta lo ya pagado).
 */
export async function applyServicePreapproval(pre: Preapproval) {
  const ref = parseServiceReference(pre.external_reference);
  if (!ref) throw new Error("La suscripción no es de un servicio.");
  const db = supabaseAdmin();
  const { data: current } = await db.from("bpos_services").select("status, mp_preapproval_id, trial_ends_at").eq("business_id", ref.businessId).eq("service", ref.service).maybeSingle();
  const previous = (current?.mp_preapproval_id as string | null) || null;
  const isCurrent = !previous || previous === pre.id;
  const now = new Date().toISOString();

  let update: Record<string, unknown> | null = null;
  if (pre.status === "authorized") {
    const next = pre.next_payment_date ? new Date(pre.next_payment_date) : new Date(Date.now() + 30 * DAY);
    update = { status: "active", paid_until: new Date(next.getTime() + GRACE_DAYS * DAY).toISOString(), mp_preapproval_id: pre.id, mp_payer_email: pre.payer_email || null, updated_at: now };
    if (previous && previous !== pre.id) await cancelPreapproval(previous).catch(() => undefined);
  } else if (!isCurrent) {
    return { ...ref, status: pre.status, ignored: true };
  } else if (pre.status === "paused" && current?.status === "active") {
    update = { status: "past_due", updated_at: now };
  } else if (pre.status === "cancelled" && current?.status === "active") {
    update = { status: "cancelled", updated_at: now };
  }
  if (!update) return { ...ref, status: pre.status };
  if (current) {
    const { error } = await db.from("bpos_services").update(update).eq("business_id", ref.businessId).eq("service", ref.service);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await db.from("bpos_services").insert({ business_id: ref.businessId, service: ref.service, ...update });
    if (error) throw new Error(error.message);
  }
  return { ...ref, status: pre.status };
}

/**
 * Al volver de Mercado Pago: revisa la suscripción (la que trae la dirección de regreso o la
 * guardada). Solo se aplica si de verdad es de este negocio y este servicio.
 */
export async function syncServicePayment(businessId: string, service: ServiceId, preapprovalId?: string) {
  const row = (await businessServices(businessId)).find((r) => r.service === service);
  const id = preapprovalId || row?.mp_preapproval_id;
  if (!id) return null;
  const pre = await getPreapproval(id);
  const ref = parseServiceReference(pre.external_reference);
  if (!ref || ref.businessId !== businessId || ref.service !== service) return null;
  return applyServicePreapproval(pre);
}

/** Cancela la suscripción del servicio (sigue hasta lo ya pagado) */
export async function cancelService(businessId: string, service: ServiceId) {
  const row = (await businessServices(businessId)).find((r) => r.service === service);
  if (!row) throw new Error("Ese servicio no está contratado.");
  if (row.mp_preapproval_id) await cancelPreapproval(row.mp_preapproval_id).catch(() => undefined);
  const { error } = await supabaseAdmin().from("bpos_services").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("business_id", businessId).eq("service", service);
  if (error) throw new Error(error.message);
}
