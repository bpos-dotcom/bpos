import { randomBytes, randomInt } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { aiPreflight, aiReply } from "@/lib/ai/cloud";
import { supabaseAdmin } from "@/lib/billing/mercadopago";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/client";

/**
 * App de meseros (migración 0026). Corre en Vercel con la llave de servicio.
 *   GET    ?branch=<id>                          celulares vinculados de la sucursal (sesión del negocio)
 *   POST   { accion: "codigo", branchId }        código de 6 dígitos, 15 minutos (sesión del negocio)
 *   POST   { accion: "vincular", slug, code, name }   desde el celular: crea la cuenta del dispositivo
 *                                                      y regresa con qué entrar (correo y contraseña)
 *   PATCH  { accion: "visto" }                    el celular avisa que sigue en uso (sesión del dispositivo)
 *   DELETE ?id=<dispositivo>                     desvincular: borra la cuenta del dispositivo (sesión del negocio)
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE_MINUTES = 15;
const DEVICE_DOMAIN = "dispositivos.bpos.com.mx";

class Friendly extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function OPTIONS(request: NextRequest) {
  return aiPreflight(request);
}

const fail = (request: NextRequest, error: unknown) =>
  error instanceof Friendly ? aiReply(request, { success: false, error: error.message }, error.status) : aiReply(request, { success: false, error: error instanceof Error ? error.message : "No se pudo." }, 502);

/** Sesión de una cuenta del negocio (dueño, admin o dispositivo). */
async function businessSession(request: NextRequest) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) throw new Friendly("Inicia sesión con la cuenta del negocio.", 401);
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Friendly("Sesión no válida.", 401);
  const { data: member } = await supabase.from("business_members").select("business_id, role").eq("user_id", data.user.id).limit(1);
  const row = member?.[0];
  if (!row) throw new Friendly("Tu cuenta no tiene negocio.", 403);
  if (row.role === "device") throw new Friendly("Esto se hace desde la cuenta del negocio, no desde un celular de mesero.", 403);
  const { data: branches } = await supabase.from("branches").select("id").eq("business_id", row.business_id);
  return { userId: data.user.id, businessId: row.business_id as string, branchIds: (branches || []).map((b) => b.id as string) };
}

export async function GET(request: NextRequest) {
  try {
    const session = await businessSession(request);
    const branch = request.nextUrl.searchParams.get("branch") || "";
    if (!session.branchIds.includes(branch)) throw new Friendly("Sucursal no encontrada.", 404);
    const { data, error } = await supabaseAdmin().from("bpos_waiter_devices").select("id, name, created_at, last_seen_at").eq("branch_id", branch).is("revoked_at", null).order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return aiReply(request, { success: true, devices: data || [] });
  } catch (error) {
    return fail(request, error);
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  try {
    if (body?.accion === "codigo") return aiReply(request, { success: true, ...(await newCode(request, String(body.branchId || ""))) });
    if (body?.accion === "vincular") return aiReply(request, { success: true, ...(await link(String(body.slug || ""), String(body.code || ""), String(body.name || ""))) });
    throw new Friendly("Acción desconocida.");
  } catch (error) {
    return fail(request, error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = request.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) throw new Friendly("Sin sesión.", 401);
    const { data, error } = await supabaseAdmin().auth.getUser(token);
    if (error || !data.user) throw new Friendly("Sesión no válida.", 401);
    await supabaseAdmin().from("bpos_waiter_devices").update({ last_seen_at: new Date().toISOString() }).eq("user_id", data.user.id).is("revoked_at", null);
    return aiReply(request, { success: true });
  } catch (error) {
    return fail(request, error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await businessSession(request);
    const id = request.nextUrl.searchParams.get("id") || "";
    const db = supabaseAdmin();
    const { data: device } = await db.from("bpos_waiter_devices").select("id, user_id, business_id").eq("id", id).eq("business_id", session.businessId).maybeSingle();
    if (!device) throw new Friendly("Celular no encontrado.", 404);
    await db.from("business_members").delete().eq("business_id", device.business_id).eq("user_id", device.user_id);
    await db.from("bpos_waiter_devices").update({ revoked_at: new Date().toISOString() }).eq("id", device.id);
    await db.auth.admin.deleteUser(device.user_id).catch(() => undefined);
    return aiReply(request, { success: true });
  } catch (error) {
    return fail(request, error);
  }
}

async function newCode(request: NextRequest, branchId: string) {
  const session = await businessSession(request);
  if (!session.branchIds.includes(branchId)) throw new Friendly("Sucursal no encontrada.", 404);
  const db = supabaseAdmin();
  await db.from("bpos_waiter_codes").delete().lt("expires_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expires = new Date(Date.now() + CODE_MINUTES * 60 * 1000).toISOString();
    const { error } = await db.from("bpos_waiter_codes").insert({ code, business_id: session.businessId, branch_id: branchId, created_by: session.userId, expires_at: expires });
    if (!error) return { code, expiresAt: expires };
    if (error.code !== "23505") throw new Error(error.message);
  }
  throw new Friendly("No se pudo generar el código. Intenta de nuevo.", 500);
}

/** El celular teclea el código: se crea su cuenta de dispositivo y se le regresa con qué entrar. */
async function link(slug: string, code: string, name: string) {
  const db = supabaseAdmin();
  const cleanSlug = slug.trim().toLowerCase();
  const cleanCode = code.replace(/\D/g, "");
  if (cleanCode.length !== 6) throw new Friendly("El código es de 6 dígitos.");
  const { data: linkRow } = await db.from("bpos_menu_links").select("business_id, branch_id").eq("slug", cleanSlug).maybeSingle();
  if (!linkRow) throw new Friendly("Esa liga no existe. Revisa la dirección que te dieron.", 404);
  const { data: codeRow } = await db.from("bpos_waiter_codes").select("code, business_id, branch_id, expires_at, used_at").eq("code", cleanCode).maybeSingle();
  if (!codeRow || codeRow.business_id !== linkRow.business_id || codeRow.branch_id !== linkRow.branch_id) throw new Friendly("Código incorrecto. Pide uno nuevo en Configuración → Meseros.");
  if (codeRow.used_at || Date.parse(codeRow.expires_at) < Date.now()) throw new Friendly("Ese código ya venció. Pide uno nuevo en Configuración → Meseros.");

  const email = `mesero-${randomBytes(8).toString("hex")}@${DEVICE_DOMAIN}`;
  const password = randomBytes(24).toString("base64url");
  const { data: created, error: userError } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { kind: "waiter-device", business_id: linkRow.business_id, branch_id: linkRow.branch_id } });
  if (userError || !created.user) throw new Error(userError?.message || "No se pudo crear la cuenta del celular.");
  const userId = created.user.id;
  const { error: memberError } = await db.from("business_members").insert({ business_id: linkRow.business_id, user_id: userId, role: "device" });
  if (memberError) {
    await db.auth.admin.deleteUser(userId).catch(() => undefined);
    throw new Error(memberError.message);
  }
  const deviceName = name.trim().slice(0, 40) || "Celular de mesero";
  const { data: device, error: deviceError } = await db
    .from("bpos_waiter_devices")
    .insert({ business_id: linkRow.business_id, branch_id: linkRow.branch_id, user_id: userId, name: deviceName, last_seen_at: new Date().toISOString() })
    .select("id")
    .single();
  if (deviceError) throw new Error(deviceError.message);
  await db.from("bpos_waiter_codes").update({ used_at: new Date().toISOString() }).eq("code", cleanCode);
  return { email, password, deviceId: device.id, branchId: linkRow.branch_id, name: deviceName };
}
