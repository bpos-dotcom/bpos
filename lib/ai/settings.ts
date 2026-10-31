/**
 * Claves de IA de la plataforma por función (solo corre en Vercel).
 *
 * El dueño de B-POS las pone en Configuración → Administrador → Claves de
 * IA (app/api/admin/ia). Se guardan cifradas en bpos_ai_settings (0017).
 * Si una función no tiene clave guardada, se usa ANTHROPIC_API_KEY de
 * Vercel con Claude Opus, como antes.
 *
 * Cifrado: AES-256-GCM con BPOS_SECRETS_KEY (si existe en Vercel) o, si no,
 * una llave derivada de SUPABASE_SERVICE_ROLE_KEY.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/supabase/client";

export type AiFeature = "interprete" | "asesor";
export type AiProvider = "anthropic" | "gemini";

export type AiConfig = {
  feature: AiFeature;
  provider: AiProvider;
  model: string;
  key: string;
  priceIn: number;
  priceOut: number;
  /** De dónde salió la clave */
  source: "admin" | "vercel";
};

export const FEATURES: { id: AiFeature; title: string; text: string }[] = [
  { id: "interprete", title: "Intérprete de fotos y tickets", text: "Compras con foto de ticket, menú con IA y sugerencias del Bridge." },
  { id: "asesor", title: "Asesor con IA", text: "Resumen semanal, consejos con los números del restaurante y chat con el dueño." },
];

/** Modelos sugeridos (se puede escribir otro) y su precio por millón de tokens en dólares, como referencia */
export const MODELS: Record<AiProvider, { id: string; label: string; priceIn?: number; priceOut?: number }[]> = {
  anthropic: [
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (rápido y económico)" },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (equilibrado)" },
    { id: "claude-opus-5-5", label: "Claude Opus 5.5 (el más capaz)", priceIn: 4, priceOut: 20 },
  ],
  gemini: [
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite (el más económico)", priceIn: 0.1, priceOut: 0.4 },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (equilibrado)", priceIn: 0.3, priceOut: 2.5 },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro (el más capaz)", priceIn: 1.25, priceOut: 10 },
  ],
};

const DEFAULT: Omit<AiConfig, "feature" | "key" | "source"> = { provider: "anthropic", model: "claude-opus-5-5", priceIn: 4, priceOut: 20 };

export function adminDb() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en Vercel.");
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function secret() {
  const base = process.env.BPOS_SECRETS_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!base) throw new Error("Falta la llave de cifrado en Vercel.");
  return createHash("sha256").update(`bpos-ai-keys:${base}`).digest();
}

export function encryptKey(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${data.toString("base64")}`;
}

function decryptKey(stored: string) {
  const [v, iv, tag, data] = stored.split(":");
  if (v !== "v1" || !iv || !tag || !data) return "";
  try {
    const decipher = createDecipheriv("aes-256-gcm", secret(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

export const keyHint = (key: string) => (key ? `…${key.slice(-4)}` : "");

export type AiSettingRow = { feature: AiFeature; provider: AiProvider; model: string; key_cipher: string; key_hint: string; price_in: number; price_out: number; updated_by: string; updated_at: string };

/** Proveedor, modelo y clave para una función (null si no hay ninguna clave disponible) */
export async function getAiConfig(feature: AiFeature): Promise<AiConfig | null> {
  try {
    const { data } = await adminDb().from("bpos_ai_settings").select("*").eq("feature", feature).maybeSingle();
    const row = data as AiSettingRow | null;
    const key = row?.key_cipher ? decryptKey(row.key_cipher) : "";
    if (row && key) {
      return { feature, provider: row.provider, model: row.model, key, priceIn: Number(row.price_in) || 0, priceOut: Number(row.price_out) || 0, source: "admin" };
    }
  } catch (e) {
    console.error("[B-POS] No se pudieron leer las claves de IA:", e instanceof Error ? e.message : e);
  }
  const envKey = process.env.ANTHROPIC_API_KEY?.trim();
  return envKey ? { feature, ...DEFAULT, key: envKey, source: "vercel" } : null;
}
