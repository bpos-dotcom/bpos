import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { SUPABASE_URL } from "@/lib/supabase/client";
import { PUSH_SERVER, VAPID_PUBLIC_KEY } from "@/lib/push/rules";
import { sendPush, type PushSubscriptionRow } from "@/lib/push/server";

/**
 * Entrega 3 · Aviso al celular del dueño cuando un cliente califica su
 * pedido con 1 a 3 estrellas.
 *
 * Lo llama la página del pedido del cliente (sin sesión):
 *   POST { id, token }  (la misma llave con la que ve su pedido)
 * El texto sale de bpos_reviews (no de lo que mande el navegador) y
 * push_log evita mandar el mismo aviso dos veces.
 *
 * En Vercel: VAPID_PRIVATE_KEY y SUPABASE_SERVICE_ROLE_KEY.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reply = (body: object, status = 200) => NextResponse.json(body, { status });

export async function POST(request: NextRequest) {
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!privateKey || !serviceKey) return reply({ success: false, error: "Avisos no configurados." }, 503);

  let id = "";
  let token = "";
  try {
    const body = await request.json();
    id = typeof body?.id === "string" ? body.id : "";
    token = typeof body?.token === "string" ? body.token : "";
  } catch {
    return reply({ success: false, error: "Petición inválida." }, 400);
  }
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f]{32}$/i.test(token)) return reply({ success: false, error: "Petición inválida." }, 400);

  const supabase = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: order } = await supabase.from("bpos_online_orders").select("id, business_id").eq("id", id).eq("token", token).maybeSingle();
  if (!order) return reply({ success: false, error: "Pedido no encontrado." }, 404);
  const { data: review } = await supabase
    .from("bpos_reviews")
    .select("id, business_id, folio, stars, comment, customer_name, updated_at")
    .eq("order_id", order.id)
    .maybeSingle();
  if (!review || review.stars > 3) return reply({ success: true, sent: 0 });

  // Una vez por calificación (si la cambia, se avisa de nuevo)
  const eventId = `review:${review.id}:${review.updated_at}`;
  const { data: fresh } = await supabase
    .from("push_log")
    .upsert({ business_id: review.business_id, event_id: eventId }, { onConflict: "business_id,event_id", ignoreDuplicates: true })
    .select("event_id");
  if (!fresh?.length) return reply({ success: true, sent: 0 });

  const { data: subs } = await supabase.from("push_subscriptions").select("id, business_id, endpoint, p256dh, auth, prefs").eq("business_id", review.business_id);
  webpush.setVapidDetails(PUSH_SERVER, VAPID_PUBLIC_KEY, privateKey);
  const payload = {
    title: `${"★".repeat(review.stars)}${"☆".repeat(5 - review.stars)} Opinión de ${review.customer_name || "un cliente"}`,
    body: review.comment ? `“${String(review.comment).slice(0, 140)}” · Pedido ${review.folio}` : `Pedido ${review.folio}. Atiéndela en Opiniones.`,
    tag: `review-${review.id}`,
    url: "/opiniones",
  };

  let sent = 0;
  const gone: number[] = [];
  await Promise.all(
    ((subs || []) as PushSubscriptionRow[])
      .filter((sub) => (sub.prefs as { opiniones?: boolean } | null)?.opiniones !== false)
      .map(async (sub) => {
        const result = await sendPush(sub, payload);
        if (result === "ok") sent += 1;
        if (result === "gone") gone.push(sub.id);
      })
  );
  if (gone.length) await supabase.from("push_subscriptions").delete().in("id", gone);
  return reply({ success: true, sent });
}
