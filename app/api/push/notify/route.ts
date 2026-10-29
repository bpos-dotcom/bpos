import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/client";
import { PUSH_ACTIONS, PUSH_SERVER, VAPID_PUBLIC_KEY, pushMessage, type PushEvent, type PushMessage } from "@/lib/push/rules";

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

// La caja llama desde http://localhost:3000; la sesión va en el encabezado (sin cookies)
function cors(request: NextRequest) {
  return {
    "Access-Control-Allow-Origin": request.headers.get("origin") || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function reply(request: NextRequest, body: object, status = 200) {
  return NextResponse.json(body, { status, headers: cors(request) });
}

export function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(request) });
}

type Subscription = { id: number; business_id: string; endpoint: string; p256dh: string; auth: string; prefs: Record<string, unknown> | null };

export async function POST(request: NextRequest) {
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!privateKey) return reply(request, { success: false, error: "Falta VAPID_PRIVATE_KEY en Vercel." }, 503);

  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return reply(request, { success: false, error: "Inicia sesión con la cuenta del negocio." }, 401);

  let ids: string[] = [];
  try {
    const body = await request.json();
    ids = (Array.isArray(body?.eventIds) ? body.eventIds : []).filter((id: unknown) => typeof id === "string").slice(0, MAX_IDS);
  } catch {
    return reply(request, { success: false, error: "Petición inválida." }, 400);
  }
  if (!ids.length) return reply(request, { success: true, sent: 0 });

  // Todo con la sesión de quien llama: RLS solo deja ver su negocio
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: user, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user.user) return reply(request, { success: false, error: "Sesión no válida." }, 401);

  const { data: events, error: eventsError } = await supabase
    .from("audit_events")
    .select("business_id, event_id, action, description, metadata")
    .in("event_id", ids)
    .in("action", [...PUSH_ACTIONS]);
  if (eventsError) return reply(request, { success: false, error: eventsError.message }, 500);
  if (!events?.length) return reply(request, { success: true, sent: 0 });

  // Solo los que nadie ha avisado todavía (si dos cajas piden el mismo, gana una)
  const { data: fresh, error: logError } = await supabase
    .from("push_log")
    .upsert(
      events.map((e) => ({ business_id: e.business_id, event_id: e.event_id })),
      { onConflict: "business_id,event_id", ignoreDuplicates: true }
    )
    .select("business_id, event_id");
  if (logError) return reply(request, { success: false, error: logError.message }, 500);
  const freshKeys = new Set((fresh || []).map((r) => `${r.business_id}|${r.event_id}`));
  const toSend = events.filter((e) => freshKeys.has(`${e.business_id}|${e.event_id}`));
  if (!toSend.length) return reply(request, { success: true, sent: 0 });

  const businesses = [...new Set(toSend.map((e) => e.business_id as string))];
  const { data: subs, error: subsError } = await supabase
    .from("push_subscriptions")
    .select("id, business_id, endpoint, p256dh, auth, prefs")
    .in("business_id", businesses);
  if (subsError) return reply(request, { success: false, error: subsError.message }, 500);

  webpush.setVapidDetails(PUSH_SERVER, VAPID_PUBLIC_KEY, privateKey);

  let sent = 0;
  const gone: number[] = [];
  await Promise.all(
    ((subs || []) as Subscription[]).map(async (sub) => {
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
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify(payload),
            { TTL: 6 * 60 * 60, urgency: "high" }
          );
          sent += 1;
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          // El celular desactivó los avisos o desinstaló la app
          if (status === 404 || status === 410) {
            gone.push(sub.id);
            return;
          }
          console.error("[B-POS] No se pudo mandar el aviso push:", status, (error as Error).message);
        }
      }
    })
  );

  if (gone.length) await supabase.from("push_subscriptions").delete().in("id", gone);
  return reply(request, { success: true, sent });
}
