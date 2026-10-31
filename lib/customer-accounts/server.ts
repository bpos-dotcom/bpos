/**
 * Cuentas de clientes del menú digital (solo corre en Vercel).
 *
 * El cliente se registra con nombre, teléfono, correo y contraseña; el
 * correo se verifica con un código de 6 dígitos que manda Resend. Después
 * entra con teléfono y contraseña. Las cuentas son por negocio.
 *
 * En Vercel: SUPABASE_SERVICE_ROLE_KEY y RESEND_API_KEY
 * (opcional RESEND_FROM, por defecto "no-responder@bpos.com.mx").
 */
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/supabase/client";

export const SESSION_DAYS = 180;
const CODE_MINUTES = 15;
const MAX_CODES_PER_HOUR = 5;

export type Account = {
  id: string;
  business_id: string;
  phone: string;
  name: string;
  email: string;
  password_hash: string;
  email_verified_at: string | null;
  address: Record<string, unknown>;
  failed_logins: number;
  locked_until: string | null;
};

export class Friendly extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function admin(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Friendly("Las cuentas de clientes aún no están configuradas.", 503);
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ------------------------------------------------------------ datos

export const cleanPhone = (v: unknown) => String(v || "").replace(/\D/g, "").slice(-10);
export const cleanEmail = (v: unknown) => String(v || "").trim().toLowerCase().slice(0, 120);
export const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}

export function checkPassword(password: string, stored: string) {
  const [kind, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const a = Buffer.from(hash, "hex");
  const b = scryptSync(password, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function checkNewPassword(password: string) {
  if (password.length < 6) throw new Friendly("La contraseña lleva al menos 6 caracteres.");
  if (password.length > 72) throw new Friendly("La contraseña es demasiado larga.");
}

/** "j***@gmail.com" para decirle al cliente a dónde llegó el código */
export const maskEmail = (email: string) => {
  const [user, domain] = email.split("@");
  return user && domain ? `${user[0]}${"*".repeat(Math.max(1, Math.min(user.length - 1, 5)))}@${domain}` : email;
};

/** El restaurante de una liga (bpos.com.mx/m/<liga>): negocio, nombre, color y logo */
export async function restaurant(db: SupabaseClient, slug: string) {
  const { data: link } = await db.from("bpos_menu_links").select("business_id").eq("slug", String(slug || "").toLowerCase().trim()).maybeSingle();
  if (!link) throw new Friendly("Este restaurante no existe.", 404);
  const { data: settings } = await db
    .from("sync_records")
    .select("data")
    .eq("business_id", link.business_id)
    .eq("scope", "business")
    .eq("collection", "bpos_business_settings")
    .eq("record_id", "__doc__")
    .maybeSingle();
  const s = (settings?.data || {}) as { businessName?: string; brandColor?: string };
  return { businessId: link.business_id as string, name: s.businessName || "tu restaurante", color: /^#[0-9a-f]{6}$/i.test(s.brandColor || "") ? s.brandColor! : "#f97316" };
}

export async function findAccount(db: SupabaseClient, businessId: string, phone: string) {
  const { data } = await db.from("bpos_customer_accounts").select("*").eq("business_id", businessId).eq("phone", phone).maybeSingle();
  return (data as Account | null) || null;
}

/** Lo que ve el cliente de su cuenta */
export const publicAccount = (a: Account) => ({
  id: a.id,
  name: a.name,
  phone: a.phone,
  email: a.email,
  address: a.address || {},
});

// ------------------------------------------------------------ códigos por correo

export async function sendCode(db: SupabaseClient, account: Account, purpose: "verificar" | "contrasena", business: { name: string; color: string }) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await db.from("bpos_customer_codes").select("id", { count: "exact", head: true }).eq("account_id", account.id).gte("created_at", since);
  if ((count || 0) >= MAX_CODES_PER_HOUR) throw new Friendly("Ya te mandamos varios códigos. Espera unos minutos y revisa tu correo (también Spam).", 429);

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const { error } = await db.from("bpos_customer_codes").insert({
    account_id: account.id,
    purpose,
    code_hash: sha(`${account.id}:${code}`),
    expires_at: new Date(Date.now() + CODE_MINUTES * 60 * 1000).toISOString(),
  });
  if (error) throw new Error(error.message);
  await sendEmail(account.email, business, code, purpose, account.name);
}

/** Revisa el código más reciente; lo marca como usado si está bien */
export async function redeemCode(db: SupabaseClient, account: Account, purpose: "verificar" | "contrasena", code: string) {
  const { data } = await db
    .from("bpos_customer_codes")
    .select("id, code_hash, attempts, expires_at, used_at")
    .eq("account_id", account.id)
    .eq("purpose", purpose)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data || data.used_at || Date.parse(data.expires_at) < Date.now()) throw new Friendly("El código ya venció. Pide uno nuevo.");
  if (data.attempts >= 5) throw new Friendly("Demasiados intentos. Pide un código nuevo.");
  if (data.code_hash !== sha(`${account.id}:${String(code || "").replace(/\D/g, "")}`)) {
    await db.from("bpos_customer_codes").update({ attempts: data.attempts + 1 }).eq("id", data.id);
    throw new Friendly("El código no es correcto.");
  }
  await db.from("bpos_customer_codes").update({ used_at: new Date().toISOString() }).eq("id", data.id);
}

async function sendEmail(to: string, business: { name: string; color: string }, code: string, purpose: "verificar" | "contrasena", name: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Friendly("El envío de correos aún no está configurado. Avísale al restaurante.", 503);
  const from = process.env.RESEND_FROM || `${business.name.replace(/[<>"]/g, "")} <no-responder@bpos.com.mx>`;
  const what = purpose === "verificar" ? "activar tu cuenta" : "cambiar tu contraseña";
  const first = name.split(" ")[0] || "";
  const html = `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;color:#18181b">
  <h2 style="margin:0 0 8px">${escapeHtml(business.name)}</h2>
  <p>Hola${first ? ` ${escapeHtml(first)}` : ""}, tu código para ${what} es:</p>
  <p style="font-size:36px;font-weight:900;letter-spacing:8px;margin:16px 0;color:${business.color}">${code}</p>
  <p style="color:#71717a;font-size:13px">Vence en ${CODE_MINUTES} minutos. Si tú no lo pediste, ignora este correo.</p>
  <p style="color:#a1a1aa;font-size:12px;margin-top:24px">Menú digital por bpos.com.mx</p>
</div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `${code} es tu código de ${business.name}`,
      html,
      text: `Tu código para ${what} en ${business.name} es ${code}. Vence en ${CODE_MINUTES} minutos.`,
    }),
  });
  if (!res.ok) {
    console.error("[B-POS] Resend:", res.status, await res.text().catch(() => ""));
    throw new Friendly("No pudimos mandar el correo. Revisa que esté bien escrito e intenta otra vez.", 502);
  }
}

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// ------------------------------------------------------------ sesiones

export async function openSession(db: SupabaseClient, accountId: string) {
  const token = randomBytes(32).toString("hex");
  const { error } = await db.from("bpos_customer_sessions").insert({
    token_hash: sha(token),
    account_id: accountId,
    expires_at: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (error) throw new Error(error.message);
  return token;
}

/** La cuenta de quien llama (Authorization: Bearer <llave>) en ese restaurante */
export async function sessionAccount(db: SupabaseClient, authorization: string | null, businessId: string) {
  const token = (authorization || "").startsWith("Bearer ") ? authorization!.slice(7).trim() : "";
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Friendly("Inicia sesión.", 401);
  const { data: session } = await db.from("bpos_customer_sessions").select("account_id, expires_at, last_seen_at").eq("token_hash", sha(token)).maybeSingle();
  if (!session || Date.parse(session.expires_at) < Date.now()) throw new Friendly("Tu sesión terminó. Entra otra vez.", 401);
  const { data: account } = await db.from("bpos_customer_accounts").select("*").eq("id", session.account_id).maybeSingle();
  if (!account || account.business_id !== businessId) throw new Friendly("Inicia sesión.", 401);
  // Una vez al día se anota que sigue usando la sesión
  if (Date.now() - Date.parse(session.last_seen_at) > 24 * 60 * 60 * 1000) {
    await db.from("bpos_customer_sessions").update({ last_seen_at: new Date().toISOString() }).eq("token_hash", sha(token));
  }
  return { account: account as Account, tokenHash: sha(token) };
}
