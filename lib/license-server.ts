/**
 * Permiso de uso firmado (solo en Vercel, con la llave de servicio).
 *
 * Permiso = base64url(JSON) + "." + base64url(firma Ed25519)
 *   { b: negocio, u: válido hasta (ms), i: emitido (ms), l: bloqueado por plan }
 * Válido hasta = lo que llegue primero: fin de lo pagado o de la prueba, o
 * MAX_OFFLINE_DAYS desde ahora (para que nadie trabaje desconectado para
 * siempre). Al volver el internet se renueva solo.
 */
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { supabaseAdmin } from "@/lib/billing/mercadopago";
import { planAccess, type PlanState } from "@/lib/plans";
import { servicesLicense, type ServiceRow } from "@/lib/services";

export const MAX_OFFLINE_DAYS = 3;
const DAY = 86_400_000;

export type LicensePayload = { b: string; u: number; i: number; l: boolean };

const b64url = (buf: Buffer) => buf.toString("base64url");

let cached: { publicKey: string; privatePem: string } | null = null;

/** La llave de firma (la genera la primera vez y la guarda en bpos_license_keys) */
export async function licenseKeys() {
  if (cached) return cached;
  const db = supabaseAdmin();
  const { data } = await db.from("bpos_license_keys").select("public_key, private_key").eq("id", 1).maybeSingle();
  if (data) {
    cached = { publicKey: data.public_key, privatePem: data.private_key };
    return cached;
  }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  // Si dos llegan al mismo tiempo, se queda la primera que se guardó
  await db.from("bpos_license_keys").upsert({ id: 1, public_key: jwk.x, private_key: pem }, { onConflict: "id", ignoreDuplicates: true });
  const { data: saved, error } = await db.from("bpos_license_keys").select("public_key, private_key").eq("id", 1).single();
  if (error || !saved) throw new Error("No se pudo preparar la llave de permisos.");
  cached = { publicKey: saved.public_key, privatePem: saved.private_key };
  return cached;
}

/** Permiso firmado para ese negocio según su plan */
export async function issueLicense(businessId: string, now = Date.now()) {
  const db = supabaseAdmin();
  const { data: business } = await db.from("businesses").select("*").eq("id", businessId).maybeSingle();
  if (!business) throw new Error("Negocio no encontrado.");
  let locked: boolean;
  let planEnd: number;
  if (business.account_kind === "servicios") {
    // Solo servicios: abierto mientras alguno esté vigente, hasta el que venza al último
    const { data: rows } = await db.from("bpos_services").select("service, status, trial_ends_at, paid_until").eq("business_id", businessId);
    const access = servicesLicense((rows || []) as ServiceRow[], now);
    locked = access.locked;
    planEnd = access.end ?? Infinity;
  } else {
    const state = business as PlanState;
    locked = planAccess(state, now).locked;
    const ends = [state.plan_status === "trial" ? state.trial_ends_at : state.paid_until].filter(Boolean).map((d) => Date.parse(String(d)));
    planEnd = ends.length ? Math.min(...ends) : Infinity; // plan activo sin fecha: activación manual, no vence
  }
  const until = locked ? now : Math.min(planEnd, now + MAX_OFFLINE_DAYS * DAY);
  const payload: LicensePayload = { b: businessId, u: until, i: now, l: locked };
  const { privatePem } = await licenseKeys();
  const body = Buffer.from(JSON.stringify(payload));
  const signature = sign(null, body, createPrivateKey(privatePem));
  return { token: `${b64url(body)}.${b64url(signature)}`, payload };
}
