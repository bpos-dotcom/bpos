/**
 * Pago en línea del menú digital con el Mercado Pago del NEGOCIO (corre solo
 * en Vercel). El cliente elige "Mercado Pago", B-POS guarda el pedido y lo
 * manda a pagar a Mercado Pago (Checkout Pro) con la cuenta que el negocio
 * vinculó en Métodos de pago. El dinero cae directo en esa cuenta.
 *
 * El pago se confirma preguntándole a Mercado Pago con la llave del negocio
 * (aviso automático /api/mp/menu-webhook, o al regresar el cliente), nunca
 * con lo que diga el navegador. Mientras no se pague, el pedido no le suena
 * al negocio. Se guarda en data.mp del pedido.
 */
import { supabaseAdmin } from "@/lib/billing/mercadopago";
import { merchantToken, mpCall } from "@/lib/mp/merchant";
import { PUSH_SERVER } from "@/lib/push/rules";
import type { OnlineMpPayment, OnlineOrderData } from "@/lib/digital-menu";

type OrderRow = { id: string; business_id: string; branch_id: string; folio: string; token: string; status: string; data: OnlineOrderData; created_at: string };
type MpPayment = { id: number | string; status: string; status_detail?: string; transaction_amount?: number; external_reference?: string; date_approved?: string | null };

const COLUMNS = "id, business_id, branch_id, folio, token, status, data, created_at";

async function findOrder(id: string, token?: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  let q = supabaseAdmin().from("bpos_online_orders").select(COLUMNS).eq("id", id);
  if (token !== undefined) q = q.eq("token", token);
  const { data } = await q.maybeSingle();
  return (data as OrderRow | null) || null;
}

/** ¿El negocio de esa liga tiene Mercado Pago vinculado? (para mostrar la opción en el menú) */
export async function menuAcceptsMp(slug: string) {
  const db = supabaseAdmin();
  const { data: link } = await db.from("bpos_menu_links").select("business_id").eq("slug", slug.trim().toLowerCase()).maybeSingle();
  if (!link) return false;
  const { data: account } = await db.from("bpos_mp_accounts").select("business_id").eq("business_id", link.business_id).maybeSingle();
  return Boolean(account);
}

/** Liga de Mercado Pago para pagar un pedido que el cliente acaba de mandar. */
export async function menuCheckout(id: string, token: string) {
  const order = await findOrder(id, token);
  if (!order) throw new Error("No encontramos tu pedido.");
  if (order.data.payment !== "Mercado Pago") throw new Error("Este pedido no se paga en línea.");
  if (order.data.mp) throw new Error("Este pedido ya está pagado.");
  if (order.status !== "nuevo") throw new Error("Este pedido ya no se puede pagar.");
  if (Date.now() - Date.parse(order.created_at) > 2 * 60 * 60 * 1000) {
    throw new Error("Este pedido venció. Haz uno nuevo.");
  }
  const total = Math.round(Number(order.data.total) * 100) / 100;
  if (!(total > 0)) throw new Error("El total del pedido no es válido.");

  const db = supabaseAdmin();
  const [{ data: link }, { data: business }] = await Promise.all([
    db.from("bpos_menu_links").select("slug").eq("branch_id", order.branch_id).maybeSingle(),
    db.from("businesses").select("name").eq("id", order.business_id).maybeSingle(),
  ]);
  const key = await merchantToken(order.business_id);
  if (!key || !link?.slug) throw new Error("El negocio todavía no tiene activado el pago en línea. Elige otra forma de pago.");

  const back = `${PUSH_SERVER}/m/${link.slug}?pedido=${order.id}&t=${order.token}&pago=1`;
  const name = String(business?.name || "B-POS").slice(0, 60);
  const pref = await mpCall<{ id: string; init_point: string }>(key, "/checkout/preferences", {
    method: "POST",
    body: JSON.stringify({
      items: [{ id: order.folio, title: `Pedido ${order.folio} · ${name}`, quantity: 1, unit_price: total, currency_id: "MXN" }],
      payer: { name: String(order.data.customer?.name || "").slice(0, 60) },
      external_reference: order.id,
      back_urls: { success: back, pending: back, failure: back },
      auto_return: "approved",
      notification_url: `${PUSH_SERVER}/api/mp/menu-webhook?b=${order.business_id}`,
      // Comida para hoy: solo pagos que se aprueban al momento (sin OXXO ni pendientes)
      binary_mode: true,
      payment_methods: { excluded_payment_types: [{ id: "ticket" }, { id: "atm" }], installments: 1 },
      expires: true,
      expiration_date_to: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      statement_descriptor: name.replace(/[^A-Za-z0-9 ]/g, "").slice(0, 22) || undefined,
    }),
  });
  return pref.init_point;
}

/** Guarda en el pedido lo que dice Mercado Pago del pago (aprobado o devuelto). */
async function applyPayment(order: OrderRow, payment: MpPayment) {
  if (String(payment.external_reference || "") !== order.id) return order.data.mp || null;
  const current = order.data.mp;
  let next: OnlineMpPayment | null = null;
  if (payment.status === "approved" && !current) {
    next = {
      status: "approved",
      paymentId: String(payment.id),
      amount: Number(payment.transaction_amount || 0),
      paidAt: payment.date_approved || new Date().toISOString(),
    };
  } else if ((payment.status === "refunded" || payment.status === "charged_back") && current?.paymentId === String(payment.id) && current.status !== "refunded") {
    next = { ...current, status: "refunded", refundedAt: new Date().toISOString() };
  }
  if (!next) return current || null;
  const { error } = await supabaseAdmin()
    .from("bpos_online_orders")
    .update({ data: { ...order.data, mp: next }, updated_at: new Date().toISOString() })
    .eq("id", order.id);
  if (error) throw new Error(error.message);
  return next;
}

/** El cliente regresó de Mercado Pago (o el seguimiento pregunta): busca el pago del pedido. */
export async function menuPaymentCheck(id: string, token: string) {
  const order = await findOrder(id, token);
  if (!order) throw new Error("No encontramos tu pedido.");
  if (order.data.payment !== "Mercado Pago" || order.data.mp) return order.data.mp || null;
  const key = await merchantToken(order.business_id);
  if (!key) return null;
  const found = await mpCall<{ results?: MpPayment[] }>(key, `/v1/payments/search?external_reference=${order.id}&sort=date_created&criteria=desc&limit=10`);
  const approved = (found.results || []).find((p) => p.status === "approved");
  return approved ? applyPayment(order, approved) : null;
}

/** Aviso automático de Mercado Pago: se consulta el pago con la llave del negocio. */
export async function menuPaymentNotice(businessId: string, paymentId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(businessId) || !/^\d{1,20}$/.test(paymentId)) return;
  const key = await merchantToken(businessId);
  if (!key) return;
  const payment = await mpCall<MpPayment>(key, `/v1/payments/${paymentId}`);
  const order = payment.external_reference ? await findOrder(String(payment.external_reference)) : null;
  if (!order || order.business_id !== businessId) return;
  await applyPayment(order, payment);
}

/** Devolver el pago de un pedido que el negocio rechazó (lo pide B-POS con la sesión del negocio). */
export async function menuPaymentRefund(businessId: string, orderId: string) {
  const order = await findOrder(orderId);
  if (!order || order.business_id !== businessId) throw new Error("No encontramos ese pedido.");
  const mp = order.data.mp;
  if (!mp || mp.status !== "approved") return mp || null;
  const key = await merchantToken(businessId);
  if (!key) throw new Error("Mercado Pago ya no está vinculado: devuelve el pago desde tu cuenta de Mercado Pago.");
  await mpCall(key, `/v1/payments/${mp.paymentId}/refunds`, { method: "POST", headers: { "X-Idempotency-Key": `refund-${order.id}` }, body: "{}" });
  const next: OnlineMpPayment = { ...mp, status: "refunded", refundedAt: new Date().toISOString() };
  await supabaseAdmin()
    .from("bpos_online_orders")
    .update({ data: { ...order.data, mp: next }, updated_at: new Date().toISOString() })
    .eq("id", order.id);
  return next;
}
