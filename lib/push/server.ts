/**
 * Bloque 12 · Piezas del servidor de avisos push (solo corre en Vercel):
 * sesión del negocio, permisos para que la caja llame desde localhost y
 * envío con la llave privada.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/client";
import { PUSH_SERVER, VAPID_PUBLIC_KEY, type PushMessage } from "@/lib/push/rules";

export type PushSubscriptionRow = { id: number; business_id: string; endpoint: string; p256dh: string; auth: string; prefs: Record<string, unknown> | null };

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

export function pushReply(request: NextRequest, body: object, status = 200) {
  return NextResponse.json(body, { status, headers: cors(request) });
}

export function pushPreflight(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(request) });
}

/** Cliente de Supabase con la sesión de quien llama (RLS: solo ve su negocio), o una respuesta de error. */
export async function pushSession(request: NextRequest) {
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!privateKey) return { error: pushReply(request, { success: false, error: "Falta VAPID_PRIVATE_KEY en Vercel." }, 503) };

  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return { error: pushReply(request, { success: false, error: "Inicia sesión con la cuenta del negocio." }, 401) };

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: user, error } = await supabase.auth.getUser(token);
  if (error || !user.user) return { error: pushReply(request, { success: false, error: "Sesión no válida." }, 401) };

  webpush.setVapidDetails(PUSH_SERVER, VAPID_PUBLIC_KEY, privateKey);
  return { supabase };
}

/** Manda un aviso. "gone" = el celular ya no acepta avisos (hay que borrar la suscripción). */
export async function sendPush(sub: PushSubscriptionRow, payload: PushMessage): Promise<"ok" | "gone" | string> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 6 * 60 * 60, urgency: "high" }
    );
    return "ok";
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return "gone";
    const message = `${status || ""} ${(error as Error).message}`.trim();
    console.error("[B-POS] No se pudo mandar el aviso push:", message);
    return message;
  }
}
