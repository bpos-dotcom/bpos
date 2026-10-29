import type { NextRequest } from "next/server";
import { pushPreflight, pushReply, pushSession, sendPush, type PushSubscriptionRow } from "@/lib/push/server";

/**
 * Bloque 12 · Aviso de prueba (botón "Mandar aviso de prueba" de la App del dueño).
 *   POST { endpoint }  con  Authorization: Bearer <sesión del negocio>
 * Solo manda a una suscripción que ya esté guardada en la nube para ese negocio.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(request: NextRequest) {
  return pushPreflight(request);
}

export async function POST(request: NextRequest) {
  const session = await pushSession(request);
  if (session.error) return session.error;
  const { supabase } = session;

  let endpoint = "";
  try {
    endpoint = String((await request.json())?.endpoint || "");
  } catch {
    // sin cuerpo
  }
  if (!endpoint) return pushReply(request, { success: false, error: "Falta el dispositivo." }, 400);

  const { data: sub, error } = await supabase
    .from("push_subscriptions")
    .select("id, business_id, endpoint, p256dh, auth, prefs")
    .eq("endpoint", endpoint)
    .maybeSingle();
  if (error) return pushReply(request, { success: false, error: error.message }, 500);
  if (!sub) return pushReply(request, { success: false, error: "Este celular no está registrado en la nube. Toca Activar avisos otra vez." }, 404);

  const result = await sendPush(sub as PushSubscriptionRow, {
    title: "✅ B-POS · Aviso de prueba",
    body: "Así te llegarán los pedidos, ventas grandes, cancelaciones y cortes de caja.",
    tag: "bpos-prueba",
    url: "/dueno",
  });
  if (result === "gone") {
    await supabase.from("push_subscriptions").delete().eq("id", sub.id);
    return pushReply(request, { success: false, error: "El celular ya no acepta avisos. Toca Activar avisos otra vez." }, 410);
  }
  if (result !== "ok") return pushReply(request, { success: false, error: `El servicio de avisos rechazó el envío: ${result}` }, 502);
  return pushReply(request, { success: true });
}
