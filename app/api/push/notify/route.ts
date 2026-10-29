import type { NextRequest } from "next/server";
import { PUSH_ACTIONS, pushMessage, type PushEvent, type PushMessage } from "@/lib/push/rules";
import { pushPreflight, pushReply, pushSession, sendPush, type PushSubscriptionRow } from "@/lib/push/server";

/**
 * Bloque 12 · Manda las notificaciones push al celular del dueño.
 *
 * Corre en Vercel (es el único con la llave privada VAPID_PRIVATE_KEY).
 * Lo llama la caja después de subir eventos a la bitácora de la nube:
 *   POST { eventIds: [...] }  con  Authorization: Bearer <sesión del negocio>
 * El texto del aviso sale de audit_events (no de lo que mande la caja) y
 * push_log evita mandar el mismo aviso dos veces.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IDS = 200;
const MAX_SEPARATE = 3; // más avisos juntos se mandan como resumen

export function OPTIONS(request: NextRequest) {
  return pushPreflight(request);
}

export async function POST(request: NextRequest) {
  const session = await pushSession(request);
  if (session.error) return session.error;
  const { supabase } = session;

  let ids: string[] = [];
  try {
    const body = await request.json();
    ids = (Array.isArray(body?.eventIds) ? body.eventIds : []).filter((id: unknown) => typeof id === "string").slice(0, MAX_IDS);
  } catch {
    return pushReply(request, { success: false, error: "Petición inválida." }, 400);
  }
  if (!ids.length) return pushReply(request, { success: true, sent: 0 });

  const { data: events, error: eventsError } = await supabase
    .from("audit_events")
    .select("business_id, event_id, action, description, metadata")
    .in("event_id", ids)
    .in("action", [...PUSH_ACTIONS]);
  if (eventsError) return pushReply(request, { success: false, error: eventsError.message }, 500);
  if (!events?.length) return pushReply(request, { success: true, sent: 0 });

  // Solo los que nadie ha avisado todavía (si dos cajas piden el mismo, gana una)
  const { data: fresh, error: logError } = await supabase
    .from("push_log")
    .upsert(
      events.map((e) => ({ business_id: e.business_id, event_id: e.event_id })),
      { onConflict: "business_id,event_id", ignoreDuplicates: true }
    )
    .select("business_id, event_id");
  if (logError) return pushReply(request, { success: false, error: logError.message }, 500);
  const freshKeys = new Set((fresh || []).map((r) => `${r.business_id}|${r.event_id}`));
  const toSend = events.filter((e) => freshKeys.has(`${e.business_id}|${e.event_id}`));
  if (!toSend.length) return pushReply(request, { success: true, sent: 0 });

  const businesses = [...new Set(toSend.map((e) => e.business_id as string))];
  const { data: subs, error: subsError } = await supabase
    .from("push_subscriptions")
    .select("id, business_id, endpoint, p256dh, auth, prefs")
    .in("business_id", businesses);
  if (subsError) return pushReply(request, { success: false, error: subsError.message }, 500);

  let sent = 0;
  const gone: number[] = [];
  await Promise.all(
    ((subs || []) as PushSubscriptionRow[]).map(async (sub) => {
      const messages = toSend
        .filter((e) => e.business_id === sub.business_id)
        .map((e) => pushMessage(e as PushEvent, sub.prefs))
        .filter((m): m is PushMessage => m !== null);
      if (!messages.length) return;

      const payloads =
        messages.length <= MAX_SEPARATE
          ? messages
          : [{ title: `B-POS · ${messages.length} avisos`, body: messages.slice(0, 4).map((m) => m.title).join("\n"), tag: "bpos-resumen", url: "/dueno" }];

      for (const payload of payloads) {
        const result = await sendPush(sub, payload);
        if (result === "ok") sent += 1;
        if (result === "gone") {
          // El celular desactivó los avisos o desinstaló la app
          gone.push(sub.id);
          return;
        }
      }
    })
  );

  if (gone.length) await supabase.from("push_subscriptions").delete().in("id", gone);
  return pushReply(request, { success: true, sent });
}
