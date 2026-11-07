/**
 * Claves de IA de la plataforma por función (solo corre en Vercel).
 *
 * El dueño de B-POS las pone en Configuración → Administrador → Claves de
 * IA (app/api/admin/ia). Se guardan cifradas en bpos_ai_settings (0017).
 * Cada función guarda una clave por proveedor (la de Claude y la de
 * Gemini), así se puede cambiar de uno a otro sin volver a pegarla: en
 * key_cipher va {"anthropic": "...", "gemini": "..."} cifrado y en key_hint
 * los últimos 4 de cada una. Las filas viejas (una sola clave, sin JSON) son
 * la clave del proveedor de la fila. Claude sin clave propia usa
 * ANTHROPIC_API_KEY de Vercel; Gemini sin clave regresa a Claude Opus.
 *
 * Cifrado: AES-256-GCM con BPOS_SECRETS_KEY (si existe en Vercel) o, si no,
 * una llave derivada de SUPABASE_SERVICE_ROLE_KEY.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/supabase/client";
import { asCreditsPeriod } from "@/lib/ai/credits-period";

export type AiFeature = "interprete" | "asesor" | "fotos";
export type AiProvider = "anthropic" | "gemini" | "openai";
const PROVIDERS: AiProvider[] = ["anthropic", "gemini", "openai"];

/**
 * El Estudio de fotos vive en su propia tabla (bpos_ai_image_settings, 0030)
 * con las mismas columnas más sus BPOS Credits; funciona con OpenAI o Gemini
 * (Claude no edita imágenes), así que no regresa a la clave de Vercel.
 * OpenAI solo se usa para fotos.
 */
export const aiTable = (feature: AiFeature) => (feature === "fotos" ? "bpos_ai_image_settings" : "bpos_ai_settings");
const providersFor = (feature: AiFeature): AiProvider[] => (feature === "fotos" ? ["openai", "gemini"] : ["anthropic", "gemini"]);

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

export const FEATURES: { id: AiFeature; title: string; text: string; providers: AiProvider[] }[] = [
  { id: "interprete", title: "Intérprete de fotos y tickets", text: "Compras con foto de ticket, menú con IA y sugerencias del Bridge.", providers: providersFor("interprete") },
  { id: "asesor", title: "Asesor con IA", text: "Resumen semanal, consejos con los números del restaurante y chat con el dueño.", providers: providersFor("asesor") },
  { id: "fotos", title: "Estudio de fotos", text: "Mejora la foto de un platillo a calidad de restaurante (plan Max). Con OpenAI o Gemini: Claude no edita imágenes.", providers: providersFor("fotos") },
];

type ModelInfo = { id: string; label: string; priceIn?: number; priceOut?: number };

/**
 * Modelos de imagen para el Estudio de fotos, con precio de referencia por
 * millón de tokens (entrada = la foto que se manda, salida = la foto nueva).
 */
export const PHOTO_MODELS: Partial<Record<AiProvider, ModelInfo[]>> = {
  openai: [
    { id: "gpt-image-1", label: "GPT Image 1 (el más fiel a la foto)", priceIn: 10, priceOut: 40 },
    { id: "gpt-image-1-mini", label: "GPT Image 1 mini (más económico)", priceIn: 2.5, priceOut: 8 },
  ],
  gemini: [{ id: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image", priceIn: 0.3, priceOut: 30 }],
};
const FIRST_PHOTO_MODEL = PHOTO_MODELS.openai![0];

/** BPOS Credits del Estudio de fotos si el administrador no ha cambiado nada */
export const PHOTO_CREDITS = { perDay: 25, perUse: 5 };

/** Modelos sugeridos (se puede escribir otro) y su precio por millón de tokens en dólares, como referencia */
export const MODELS: Record<AiProvider, ModelInfo[]> = {
  // OpenAI solo está en el Estudio de fotos (PHOTO_MODELS)
  openai: [],
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

export type AiSettingRow = {
  feature: AiFeature;
  provider: AiProvider;
  model: string;
  key_cipher: string;
  key_hint: string;
  price_in: number;
  price_out: number;
  updated_by: string;
  updated_at: string;
  /** Solo el Estudio de fotos. credits_per_day: cuántos hay en el periodo (credits_period, 0032) */
  credits_per_day?: number;
  credits_per_use?: number;
  credits_period?: string;
  /** Solo el Asesor: cada cuántos días puede pedir cada negocio un análisis nuevo (0033) */
  refresh_days?: number;
  /** Prompts propios del Estudio de fotos (vacío = el de fábrica) */
  prompt_keep?: string;
  prompt_remove?: string;
};

export type ProviderKeys = Partial<Record<AiProvider, string>>;

/** Claves guardadas de una fila, por proveedor */
export function readKeys(row: Pick<AiSettingRow, "provider" | "key_cipher"> | null): ProviderKeys {
  const plain = row?.key_cipher ? decryptKey(row.key_cipher) : "";
  if (!plain) return {};
  if (plain.startsWith("{")) {
    try {
      const o = JSON.parse(plain) as Record<string, unknown>;
      return Object.fromEntries(PROVIDERS.filter((p) => typeof o[p] === "string" && o[p]).map((p) => [p, o[p] as string]));
    } catch {
      return {};
    }
  }
  return { [row!.provider]: plain };
}

/** Últimos 4 de cada clave guardada */
export function readHints(row: Pick<AiSettingRow, "provider" | "key_hint"> | null): ProviderKeys {
  const h = row?.key_hint || "";
  if (h.startsWith("{")) {
    try {
      return JSON.parse(h) as ProviderKeys;
    } catch {
      return {};
    }
  }
  return h ? { [row!.provider]: h } : {};
}

/** Columnas key_cipher y key_hint para guardar las claves */
export function packKeys(keys: ProviderKeys) {
  const clean = Object.fromEntries(Object.entries(keys).filter(([, k]) => k)) as ProviderKeys;
  if (!Object.keys(clean).length) return { key_cipher: "", key_hint: "" };
  return {
    key_cipher: encryptKey(JSON.stringify(clean)),
    key_hint: JSON.stringify(Object.fromEntries(Object.entries(clean).map(([p, k]) => [p, keyHint(k!)]))),
  };
}

/** Precio de referencia de un modelo (el guardado si es el mismo de la fila) */
function priceFor(row: AiSettingRow | null, provider: AiProvider, model: string) {
  if (row && row.provider === provider && row.model === model) return { priceIn: Number(row.price_in) || 0, priceOut: Number(row.price_out) || 0 };
  const m = [...MODELS[provider], ...(PHOTO_MODELS[provider] || [])].find((x) => x.id === model);
  if (m?.priceIn !== undefined) return { priceIn: m.priceIn, priceOut: m.priceOut || 0 };
  return model === DEFAULT.model ? { priceIn: DEFAULT.priceIn, priceOut: DEFAULT.priceOut } : { priceIn: 0, priceOut: 0 };
}

/** La fila guardada de una función (null si no hay o no se pudo leer) */
export async function readAiRow(feature: AiFeature): Promise<AiSettingRow | null> {
  try {
    const { data } = await adminDb().from(aiTable(feature)).select("*").eq("feature", feature).maybeSingle();
    return data as AiSettingRow | null;
  } catch (e) {
    console.error("[B-POS] No se pudieron leer las claves de IA:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** BPOS Credits del Estudio de fotos: cada cuánto se reinician, cuántos hay en ese periodo y cuántos gasta cada foto */
export function photoCredits(row: Pick<AiSettingRow, "credits_per_day" | "credits_per_use" | "credits_period"> | null) {
  const perPeriod = Number(row?.credits_per_day);
  const perUse = Number(row?.credits_per_use);
  return {
    period: asCreditsPeriod(row?.credits_period),
    perPeriod: Number.isFinite(perPeriod) && perPeriod >= 0 ? perPeriod : PHOTO_CREDITS.perDay,
    perUse: Number.isFinite(perUse) && perUse > 0 ? perUse : PHOTO_CREDITS.perUse,
  };
}

/**
 * Proveedor, modelo y clave para una función (null si no hay ninguna clave
 * disponible). `draft`: probar otro proveedor o modelo sin guardarlo.
 */
export async function getAiConfig(feature: AiFeature, draft?: { provider: AiProvider; model: string }): Promise<AiConfig | null> {
  const row = await readAiRow(feature);
  const photos = feature === "fotos";
  const provider = draft?.provider || row?.provider || (photos ? "openai" : DEFAULT.provider);
  const model = draft?.model || row?.model || (photos ? FIRST_PHOTO_MODEL.id : DEFAULT.model);
  const key = readKeys(row)[provider];
  if (key) return { feature, provider, model, key, ...priceFor(row, provider, model), source: "admin" };
  if (photos) return null;
  const envKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!envKey) return null;
  // Claude sin clave propia: la de Vercel con el modelo elegido. Gemini sin clave: Claude Opus, como antes
  return provider === "anthropic" ? { feature, provider, model, key: envKey, ...priceFor(row, provider, model), source: "vercel" } : { feature, ...DEFAULT, key: envKey, source: "vercel" };
}
