/**
 * Aviso al celular del dueño o del encargado cuando entra un pedido del menú
 * digital, aunque la caja esté apagada (corre en el servidor, no en la caja).
 *
 * Lo llaman la página del cliente al mandar su pedido (app/api/push/pedido)
 * y el pago de Mercado Pago al aprobarse (lib/mp/menu-payments.ts). El texto
 * sale del pedido guardado (no de lo que mande el navegador) y push_log evita
 * mandar el mismo aviso dos veces.
 *
 * Necesita VAPID_PRIVATE_KEY y SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { SUPABASE_URL } from "@/lib/supabase/client";
import { PUSH_SERVER, VAPID_PUBLIC_KEY, onlineOrderPush, type PushMessage } from "@/lib/push/rules";
import { sendPush, type PushSubscriptionRow } from "@/lib/push/server";
import type { OnlineOrderData } from "@/lib/digital-menu";

type Row = { id: string; business_id: string; folio: string; status: string; data: OnlineOrderData };

/** Manda el aviso del pedido nuevo. Regresa cuántos celulares lo recibieron. */
export async function notifyOnlineOrder(id: string, token?: string): Promise<number> {
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!privateKey || !serviceKey || !/^[0-9a-f-]{36}$/i.test(id)) return 0;

  const supabase = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let q = supabase.from("bpos_online_orders").select("id, business_id, folio, status, data").eq("id", id);
  if (token !== undefined) q = q.eq("token", token);
  const { data: order } = await q.maybeSingle();
  const payload = order ? onlineOrderPush(order as Row) : null;
  if (!order || !payload) return 0;

  // Una sola vez por pedido (la página del cliente y el pago pueden pedirlo los dos)
  const { data: fresh } = await supabase
    .from("push_log")
    .upsert({ business_id: order.business_id, event_id: `online:${order.id}` }, { onConflict: "business_id,event_id", ignoreDuplicates: true })
    .select("event_id");
  if (!fresh?.length) return 0;

  const { data: subs } = await supabase.from("push_subscriptions").select("id, business_id, endpoint, p256dh, auth, prefs").eq("business_id", order.business_id);
  webpush.setVapidDetails(PUSH_SERVER, VAPID_PUBLIC_KEY, privateKey);
  let sent = 0;
  const gone: number[] = [];
  await Promise.all(
    ((subs || []) as PushSubscriptionRow[])
      .filter((sub) => (sub.prefs as { pedidosEnLinea?: boolean } | null)?.pedidosEnLinea !== false)
      .map(async (sub) => {
        const result = await sendPush(sub, payload as PushMessage);
        if (result === "ok") sent += 1;
        if (result === "gone") gone.push(sub.id);
      })
  );
  if (gone.length) await supabase.from("push_subscriptions").delete().in("id", gone);
  return sent;
}
