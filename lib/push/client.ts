"use client";
/**
 * Bloque 12 · Notificaciones push en el navegador.
 *
 * - El celular del dueño se suscribe (App del dueño → Activar notificaciones)
 *   y queda guardado en push_subscriptions (0005_bpos_push.sql).
 * - La caja, después de subir eventos a la bitácora de la nube, le pide a
 *   B-POS en Vercel que avise (app/api/push/notify).
 */
import { loadCloudAccount } from "@/lib/cloud/account";
import { getSupabase, isCloudConfigured } from "@/lib/supabase/client";
import { DEFAULT_PUSH_PREFS, VAPID_PUBLIC_KEY, type PushPrefs } from "@/lib/push/rules";

// Solo de este dispositivo (ver DEVICE_LOCAL_KEYS)
const OUTBOX_KEY = "bpos_push_outbox";
const PREFS_KEY = "bpos_push_prefs";
const ON_KEY = "bpos_push_on";
const MAX_AGE_MS = 6 * 60 * 60 * 1000; // un aviso de hace más de 6 horas ya no sirve
let flushing = false;

type Pending = { id: string; at: number };

export function pushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** true si este dispositivo recibe avisos push (aunque la app esté cerrada) */
export function pushEnabled() {
  try {
    return pushSupported() && Notification.permission === "granted" && localStorage.getItem(ON_KEY) === "1";
  } catch {
    return false;
  }
}

export function getPushPrefs(): PushPrefs {
  try {
    return { ...DEFAULT_PUSH_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") };
  } catch {
    return DEFAULT_PUSH_PREFS;
  }
}

async function registration() {
  navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("No se pudo preparar el servicio de avisos.")), 8000)),
  ]);
}

function keyBytes(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function deviceName() {
  const ua = navigator.userAgent;
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/android/i.test(ua)) return "Android";
  if (/windows/i.test(ua)) return "Windows";
  if (/mac/i.test(ua)) return "Mac";
  return "Navegador";
}

/** Suscribe este dispositivo a los avisos push del negocio. Regresa un error en texto o "" si quedó. */
export async function enablePush(prefs: PushPrefs = getPushPrefs()): Promise<string> {
  if (!pushSupported()) return "Este navegador no permite avisos push.";
  const account = await loadCloudAccount();
  if (account.status !== "ready") return "Inicia sesión con la cuenta del negocio para activar los avisos.";

  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return "No diste permiso de notificaciones a B-POS en este navegador.";

  const reg = await registration();
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
  const json = sub.toJSON();
  const { error } = await getSupabase()
    .from("push_subscriptions")
    .upsert(
      {
        business_id: account.businessId,
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
        device_name: deviceName(),
        prefs,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" }
    );
  if (error) {
    return /push_subscriptions/.test(error.message)
      ? "Falta aplicar 0005_bpos_push.sql en Supabase."
      : `No se pudo guardar en la nube: ${error.message}`;
  }
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  localStorage.setItem(ON_KEY, "1");
  return "";
}

/** Guarda qué avisos quiere este dispositivo. */
export async function savePushPrefs(prefs: PushPrefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  if (!pushEnabled()) return;
  const reg = await registration();
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await getSupabase().from("push_subscriptions").update({ prefs, updated_at: new Date().toISOString() }).eq("endpoint", sub.endpoint);
}

/** Manda un aviso de prueba a este dispositivo. Regresa un error en texto o "" si salió. */
export async function sendTestPush(): Promise<string> {
  try {
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return "Este celular no tiene los avisos activados. Toca Activar avisos.";
    const { data } = await getSupabase().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return "Inicia sesión con la cuenta del negocio.";
    const response = await fetch("/api/push/test", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    const body = await response.json().catch(() => ({}));
    return response.ok ? "" : body.error || `Error ${response.status}`;
  } catch (e) {
    return e instanceof Error ? e.message : "No se pudo mandar el aviso de prueba.";
  }
}

export async function disablePush() {
  localStorage.removeItem(ON_KEY);
  try {
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await getSupabase().from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  } catch {
    // sin internet: el servidor la borra solo cuando el navegador la rechace
  }
}

function readOutbox(): Pending[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Eventos ya subidos a la bitácora de la nube que pueden generar aviso. */
export function queuePushEvents(ids: string[]) {
  if (typeof window === "undefined" || !ids.length) return;
  const now = Date.now();
  localStorage.setItem(OUTBOX_KEY, JSON.stringify([...readOutbox(), ...ids.map((id) => ({ id, at: now }))].slice(-500)));
}

/** Le pide a B-POS en Vercel que mande los avisos pendientes. */
export async function flushPushEvents() {
  if (flushing || typeof window === "undefined" || !isCloudConfigured) return;
  const queue = readOutbox().filter((p) => Date.now() - p.at < MAX_AGE_MS);
  if (!queue.length) {
    localStorage.removeItem(OUTBOX_KEY);
    return;
  }
  flushing = true;
  try {
    const { data } = await getSupabase().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const ids = queue.slice(0, 200).map((p) => p.id);
    const response = await fetch("/api/push/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ eventIds: ids }),
    });
    if (!response.ok) return; // se reintenta en la siguiente vuelta
    const done = new Set(ids);
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(readOutbox().filter((p) => !done.has(p.id) && Date.now() - p.at < MAX_AGE_MS)));
  } catch {
    // sin internet: se reintenta después
  } finally {
    flushing = false;
  }
}
