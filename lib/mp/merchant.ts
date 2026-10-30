/**
 * Mercado Pago del NEGOCIO (no el de B-POS): corre solo en Vercel.
 *
 * El negocio vincula su cuenta con OAuth (Configuración → Métodos de pago →
 * Vincular Mercado Pago). Se guardan sus llaves en bpos_mp_accounts, que el
 * navegador no puede leer; con ellas B-POS manda cobros a su terminal Point.
 *
 * Necesita en Vercel → Environment Variables:
 *   MP_CLIENT_SECRET  Client Secret de esa aplicación (nunca va en GitHub)
 *   SUPABASE_SERVICE_ROLE_KEY
 * y en la aplicación de Mercado Pago, la dirección de regreso
 *   https://www.bpos.com.mx/api/mp/link/callback
 */
import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { aiReply } from "@/lib/ai/cloud";
import { supabaseAdmin } from "@/lib/billing/mercadopago";
import { PUSH_SERVER as CLOUD_SERVER } from "@/lib/push/rules";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/client";

const MP_API = "https://api.mercadopago.com";
export const MP_REDIRECT_URI = `${CLOUD_SERVER}/api/mp/link/callback`;
/** App ID (Client ID) de la aplicación B-POS en Mercado Pago: es público */
const MP_CLIENT_ID = process.env.MP_CLIENT_ID || "5461571198046273";

export function merchantConfigured() {
  return Boolean(process.env.MP_CLIENT_SECRET && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

type Member = { userId: string; businessId: string; role: string; branchIds: string[] };

/** Quién llama: un usuario del negocio. `owner`: solo la cuenta dueña. */
export async function memberSession(request: NextRequest, { owner = false } = {}): Promise<{ error: ReturnType<typeof aiReply> } | Member> {
  if (!merchantConfigured()) {
    return { error: aiReply(request, { success: false, code: "setup", error: "La conexión con Mercado Pago todavía no está activada en B-POS." }, 503) };
  }
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return { error: aiReply(request, { success: false, error: "Inicia sesión con la cuenta del negocio." }, 401) };
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: user, error } = await supabase.auth.getUser(token);
  if (error || !user.user) return { error: aiReply(request, { success: false, error: "Sesión no válida." }, 401) };
  const { data: member } = await supabase.from("business_members").select("business_id, role").eq("user_id", user.user.id).limit(1);
  const row = member?.[0];
  if (!row) return { error: aiReply(request, { success: false, error: "Tu cuenta no tiene negocio." }, 403) };
  if (owner && row.role !== "owner") return { error: aiReply(request, { success: false, error: "Solo la cuenta dueña del negocio puede vincular Mercado Pago." }, 403) };
  const { data: branches } = await supabase.from("branches").select("id").eq("business_id", row.business_id);
  return { userId: user.user.id, businessId: row.business_id, role: row.role, branchIds: (branches || []).map((b) => b.id as string) };
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number; user_id: number | string; live_mode?: boolean };

async function oauthToken(params: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(`${MP_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: MP_CLIENT_ID, client_secret: process.env.MP_CLIENT_SECRET || "", ...params }),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error(body.message || body.error_description || body.error || "Mercado Pago no aceptó la vinculación.");
  return body as TokenResponse;
}

/** Liga para que el dueño autorice a B-POS en Mercado Pago. */
export function authorizationUrl(state: string) {
  const q = new URLSearchParams({ client_id: MP_CLIENT_ID, response_type: "code", platform_id: "mp", state, redirect_uri: MP_REDIRECT_URI });
  return `https://auth.mercadopago.com/authorization?${q}`;
}

/** Código que regresa Mercado Pago → llaves del negocio guardadas en la nube. */
export async function finishLink(code: string, state: string) {
  const db = supabaseAdmin();
  const { data: pending } = await db.from("bpos_mp_link_states").select("*").eq("state", state).maybeSingle();
  if (!pending || Date.now() - Date.parse(pending.created_at) > 30 * 60 * 1000) throw new Error("La vinculación venció. Inténtalo de nuevo desde B-POS.");
  await db.from("bpos_mp_link_states").delete().eq("state", state);
  const token = await oauthToken({ grant_type: "authorization_code", code, redirect_uri: MP_REDIRECT_URI });
  const me = await mpCall<{ nickname?: string; email?: string }>(token.access_token, "/users/me").catch(() => ({ nickname: "", email: "" }));
  const { error } = await db.from("bpos_mp_accounts").upsert({
    business_id: pending.business_id,
    mp_user_id: String(token.user_id),
    nickname: String(me.nickname || me.email || ""),
    access_token: token.access_token,
    refresh_token: token.refresh_token || "",
    expires_at: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null,
    live_mode: token.live_mode !== false,
    linked_by: pending.user_id,
    linked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

/** Llave vigente del negocio (se renueva sola si está por vencer). */
export async function merchantToken(businessId: string): Promise<string | null> {
  const db = supabaseAdmin();
  const { data: account } = await db.from("bpos_mp_accounts").select("*").eq("business_id", businessId).maybeSingle();
  if (!account) return null;
  const expires = account.expires_at ? Date.parse(account.expires_at) : Infinity;
  if (expires - Date.now() > 7 * 24 * 60 * 60 * 1000 || !account.refresh_token) return account.access_token as string;
  const token = await oauthToken({ grant_type: "refresh_token", refresh_token: account.refresh_token });
  await db
    .from("bpos_mp_accounts")
    .update({
      access_token: token.access_token,
      refresh_token: token.refresh_token || account.refresh_token,
      expires_at: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("business_id", businessId);
  return token.access_token;
}

/** Llamada a la API de Mercado Pago con la llave del negocio. */
export async function mpCall<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${MP_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
    cache: "no-store",
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const detail = body?.errors?.[0]?.message || body?.message || body?.error || `error ${response.status}`;
    throw new Error(`Mercado Pago: ${detail}`);
  }
  return body as T;
}

// ------------------------------------------------------------ terminal Point

export type PointTerminal = { id: string; pos_id?: string; store_id?: string; external_pos_id?: string; operating_mode?: string };

export async function listTerminals(token: string) {
  const res = await mpCall<{ data?: { terminals?: PointTerminal[] } }>(token, "/terminals/v1/list?limit=50&offset=0");
  return res.data?.terminals || [];
}

/** La terminal debe estar en modo PDV para recibir cobros desde B-POS. */
export async function setTerminalPdv(token: string, terminalId: string) {
  await mpCall(token, "/terminals/v1/setup", { method: "PATCH", body: JSON.stringify({ terminals: [{ id: terminalId, operating_mode: "PDV" }] }) });
}

export type PointOrder = { id: string; status: string; status_detail?: string; transactions?: { payments?: { id?: string; status?: string; status_detail?: string; amount?: string }[] } };

export async function createPointOrder(token: string, terminalId: string, amount: number, reference: string, description: string) {
  return mpCall<PointOrder>(token, "/v1/orders", {
    method: "POST",
    headers: { "X-Idempotency-Key": reference },
    body: JSON.stringify({
      type: "point",
      external_reference: reference,
      expiration_time: "PT5M",
      transactions: { payments: [{ amount: amount.toFixed(2) }] },
      config: { point: { terminal_id: terminalId, print_on_terminal: "no_ticket" } },
      description: description.slice(0, 150),
    }),
  });
}

export function getPointOrder(token: string, orderId: string) {
  return mpCall<PointOrder>(token, `/v1/orders/${encodeURIComponent(orderId)}`);
}

export function cancelPointOrder(token: string, orderId: string) {
  return mpCall<PointOrder>(token, `/v1/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: "POST",
    headers: { "X-Idempotency-Key": `cancel-${orderId}`, "x-allow-cancelable-status": "at_terminal" },
  });
}
