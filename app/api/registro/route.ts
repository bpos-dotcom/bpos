import { createHash, randomInt } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/billing/mercadopago";
import { TRIAL_DAYS } from "@/lib/plans";

/**
 * Crear cuenta de un negocio nuevo en B-POS, con el correo verificado por
 * código (migración 0023):
 *   POST { accion: "codigo", email }                       manda un código de 6 dígitos al correo
 *   POST { accion: "crear", email, code, password, ... }   revisa el código y crea el usuario ya confirmado
 * Después el navegador entra con la contraseña y da de alta el negocio
 * (create_business) con el nombre, la dirección y el teléfono capturados.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE_MINUTES = 15;
const MAX_CODES_PER_HOUR = 4;

class Friendly extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const cleanEmail = (v: unknown) => String(v || "").trim().toLowerCase();
const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

/** Remitente: la dirección de RESEND_FROM (dominio verificado) con el nombre B-POS */
function sender() {
  const configured = process.env.RESEND_FROM || "";
  const address = configured.match(/<([^>]+)>/)?.[1] || (configured.includes("@") ? configured : "no-responder@bpos.com.mx");
  return `B-POS <${address}>`;
}

async function sendCode(email: string, code: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Friendly("El envío de correos aún no está configurado. Escríbenos a soporte@bpos.com.mx.", 503);
  const html = `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;color:#18181b">
  <h2 style="margin:0 0 8px">B-POS</h2>
  <p>Tu código para crear la cuenta de tu negocio es:</p>
  <p style="font-size:36px;font-weight:900;letter-spacing:8px;margin:16px 0;color:#f97316">${code}</p>
  <p style="color:#71717a;font-size:13px">Vence en ${CODE_MINUTES} minutos. Si tú no lo pediste, ignora este correo.</p>
  <p style="color:#a1a1aa;font-size:12px;margin-top:24px">B-POS · Punto de venta para restaurantes · bpos.com.mx</p>
</div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: sender(),
      reply_to: "soporte@bpos.com.mx",
      to: [email],
      subject: `${code} es tu código para crear tu cuenta en B-POS`,
      html,
      text: `Tu código para crear la cuenta de tu negocio en B-POS es ${code}. Vence en ${CODE_MINUTES} minutos.`,
    }),
  });
  if (!res.ok) {
    console.error("[B-POS] Resend registro:", res.status, await res.text().catch(() => ""));
    throw new Friendly("No pudimos mandar el correo. Revisa que esté bien escrito e intenta otra vez.", 502);
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    accion?: string;
    email?: string;
    code?: string;
    password?: string;
    businessName?: string;
    address?: string;
    phone?: string;
  };
  const db = supabaseAdmin();
  const email = cleanEmail(body.email);
  try {
    if (!validEmail(email)) throw new Friendly("Escribe un correo válido.");

    if (body.accion === "codigo") {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count } = await db.from("bpos_signup_codes").select("id", { count: "exact", head: true }).eq("email", email).gte("created_at", since);
      if ((count || 0) >= MAX_CODES_PER_HOUR) throw new Friendly("Ya te mandamos varios códigos. Revisa tu correo (también Spam) o espera unos minutos.", 429);
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const { error } = await db.from("bpos_signup_codes").insert({
        email,
        code_hash: sha(`${email}:${code}`),
        expires_at: new Date(Date.now() + CODE_MINUTES * 60 * 1000).toISOString(),
      });
      if (error) throw new Error(error.message);
      await sendCode(email, code);
      return NextResponse.json({ success: true, minutes: CODE_MINUTES });
    }

    if (body.accion === "crear") {
      const password = String(body.password || "");
      const businessName = String(body.businessName || "").trim().slice(0, 60);
      const address = String(body.address || "").trim().slice(0, 200);
      const phone = String(body.phone || "").replace(/\D/g, "");
      if (password.length < 6) throw new Friendly("La contraseña debe tener al menos 6 caracteres.");
      if (businessName.length < 2) throw new Friendly("Escribe el nombre del negocio.");
      if (address.length < 5) throw new Friendly("Escribe la dirección del negocio.");
      if (phone.length < 10) throw new Friendly("Escribe un teléfono de 10 dígitos.");

      const { data: row } = await db
        .from("bpos_signup_codes")
        .select("id, code_hash, attempts, expires_at, used_at")
        .eq("email", email)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) throw new Friendly("El código venció o no existe. Pide uno nuevo.");
      if (row.attempts >= 5) throw new Friendly("Demasiados intentos. Pide un código nuevo.");
      if (row.code_hash !== sha(`${email}:${String(body.code || "").replace(/\D/g, "")}`)) {
        await db.from("bpos_signup_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
        throw new Friendly("El código no es correcto.");
      }

      const { error } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { business_name: businessName, address, phone },
      });
      if (error) {
        const m = error.message.toLowerCase();
        if (m.includes("already") || m.includes("registered") || m.includes("exists")) throw new Friendly('Ese correo ya tiene cuenta en B-POS. Usa "Entrar".', 409);
        throw new Error(error.message);
      }
      await db.from("bpos_signup_codes").update({ used_at: new Date().toISOString() }).eq("id", row.id);
      return NextResponse.json({ success: true, trialDays: TRIAL_DAYS });
    }

    throw new Friendly("Acción no válida.");
  } catch (e) {
    if (e instanceof Friendly) return NextResponse.json({ success: false, error: e.message }, { status: e.status });
    console.error("[B-POS] registro:", e);
    return NextResponse.json({ success: false, error: "No se pudo completar el registro. Intenta otra vez." }, { status: 500 });
  }
}
