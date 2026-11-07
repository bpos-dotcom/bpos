import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/client";
import { AiFailure, checkOpenAiModel, generateText } from "@/lib/ai/engine";
import { PHOTO_PROMPTS } from "@/lib/ai/photo-studio";
import { asCreditsPeriod } from "@/lib/ai/credits-period";
import { FEATURES, MODELS, PHOTO_MODELS, adminDb, aiTable, getAiConfig, packKeys, photoCredits, readHints, readKeys, type AiFeature, type AiProvider, type AiSettingRow } from "@/lib/ai/settings";

/**
 * Configuración → Administrador → Claves de IA (solo administradores de la
 * plataforma, is_platform_admin):
 *   GET                                   → funciones, proveedor, modelo, últimos 4 de cada clave
 *   POST { action: "guardar", feature, provider, model, key?, priceIn, priceOut, creditsPeriod?, creditsPerPeriod?, creditsPerUse? }
 *   POST { action: "probar", feature, provider?, model? } → una pregunta corta (lo elegido, aunque no esté guardado)
 *   POST { action: "quitar", feature, provider } → borra la clave de ese proveedor
 *   POST { action: "prompts", feature: "fotos", promptKeep, promptRemove } → prompts del Estudio de fotos (vacío = el de fábrica)
 * Se guarda una clave por proveedor: cambiar de Gemini a Claude no borra la
 * de Gemini. La clave nunca regresa al navegador. El Estudio de fotos se
 * guarda en su tabla (bpos_ai_image_settings), con OpenAI o Gemini, junto con
 * sus BPOS Credits (al día por negocio y por foto).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reply = (body: object, status = 200) => NextResponse.json(body, { status });

const PROVIDER_NAME: Record<AiProvider, string> = { anthropic: "Anthropic (Claude)", gemini: "Google (Gemini)", openai: "OpenAI" };

async function requireAdmin(request: NextRequest) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const [{ data: user }, { data: isAdmin }] = await Promise.all([db.auth.getUser(token), db.rpc("is_platform_admin")]);
  return user.user && isAdmin === true ? user.user.email || user.user.id : null;
}

async function list() {
  const db = adminDb();
  const [{ data }, photo] = await Promise.all([
    db.from("bpos_ai_settings").select("feature, provider, model, key_hint, price_in, price_out, updated_by, updated_at"),
    // Todo (también los prompts si ya está la migración 0031); la clave cifrada no sale de aquí
    db.from(aiTable("fotos")).select("*"),
  ]);
  const rows = [...((data || []) as Omit<AiSettingRow, "key_cipher">[]), ...((photo.data || []) as Omit<AiSettingRow, "key_cipher">[])];
  const vercel = Boolean(process.env.ANTHROPIC_API_KEY);
  return {
    models: MODELS,
    vercelFallback: vercel,
    features: FEATURES.map((f) => {
      const photos = f.id === "fotos";
      const r = rows.find((x) => x.feature === f.id);
      const provider = r?.provider || (photos ? "openai" : "anthropic");
      const firstPhoto = PHOTO_MODELS.openai![0];
      const model = r?.model || (photos ? firstPhoto.id : "claude-opus-5-5");
      const hints = readHints(r || null);
      const own = Boolean(hints[provider]);
      // El Estudio de fotos no usa la clave de Vercel (es de Claude, que no edita imágenes)
      const fallback = vercel && !photos;
      return {
        ...f,
        provider,
        model,
        keyHints: hints,
        // Lo que de verdad se usa (Gemini sin clave regresa a Claude Opus de Vercel)
        running: own ? { provider, model } : fallback ? { provider: "anthropic", model: provider === "anthropic" ? model : "claude-opus-5-5" } : null,
        priceIn: r ? Number(r.price_in) : photos ? firstPhoto.priceIn : 4,
        priceOut: r ? Number(r.price_out) : photos ? firstPhoto.priceOut : 20,
        updatedBy: r?.updated_by || "",
        updatedAt: r?.updated_at || "",
        active: own ? "admin" : fallback ? "vercel" : "ninguna",
        ...(photos
          ? {
              models: PHOTO_MODELS,
              // periodReady: ya existe la columna credits_period (migración 0032)
              credits: { ...photoCredits(r || null), periodReady: !photo.error && (!r || "credits_period" in r) },
              missingTable: Boolean(photo.error),
              prompts: { keep: r?.prompt_keep || "", remove: r?.prompt_remove || "", defaults: PHOTO_PROMPTS, editable: !photo.error && (!r || "prompt_keep" in r) },
            }
          : {}),
      };
    }),
  };
}

export async function GET(request: NextRequest) {
  if (!(await requireAdmin(request))) return reply({ error: "Solo para el administrador de B-POS." }, 403);
  try {
    return reply(await list());
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : "No se pudo leer." }, 500);
  }
}

export async function POST(request: NextRequest) {
  const who = await requireAdmin(request);
  if (!who) return reply({ error: "Solo para el administrador de B-POS." }, 403);
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return reply({ error: "Petición inválida." }, 400);
  }
  const feature = body.feature as AiFeature;
  const info = FEATURES.find((f) => f.id === feature);
  if (!info) return reply({ error: "Función desconocida." }, 400);
  const db = adminDb();
  const table = aiTable(feature);

  try {
    if (body.action === "guardar") {
      const provider = body.provider as AiProvider;
      if (!info.providers.includes(provider)) return reply({ error: feature === "fotos" ? "El Estudio de fotos funciona con OpenAI o Gemini." : "Proveedor desconocido." }, 400);
      const model = String(body.model || "").trim().slice(0, 80);
      if (!/^[a-z0-9.\-]+$/i.test(model)) return reply({ error: "Escribe el modelo (ej. gemini-2.5-flash-lite)." }, 400);
      const key = String(body.key || "").trim();
      const priceIn = Math.max(0, Number(body.priceIn) || 0);
      const priceOut = Math.max(0, Number(body.priceOut) || 0);
      const { data: current } = await db.from(table).select("provider, key_cipher").eq("feature", feature).maybeSingle();
      const keys = readKeys(current as Pick<AiSettingRow, "provider" | "key_cipher"> | null);
      if (key && key.length < 20) return reply({ error: "La clave se ve incompleta." }, 400);
      if (key) keys[provider] = key;
      // Sin clave guardada de ese proveedor se pide (Claude puede usar la de Vercel)
      if (!keys[provider] && !(provider === "anthropic" && process.env.ANTHROPIC_API_KEY)) return reply({ error: `Pega la clave de ${PROVIDER_NAME[provider]}.` }, 400);
      // BPOS Credits del Estudio de fotos: cada cuánto se reinician, cuántos por negocio en ese periodo y por foto
      const period = asCreditsPeriod(body.creditsPeriod);
      const credits =
        feature === "fotos"
          ? {
              credits_per_day: Math.min(100000, Math.max(0, Math.round(Number(body.creditsPerPeriod ?? body.creditsPerDay) || 0))),
              credits_per_use: Math.min(10000, Math.max(1, Math.round(Number(body.creditsPerUse) || 0))),
              credits_period: period,
            }
          : {};
      const row: Record<string, unknown> = { feature, provider, model, ...packKeys(keys), price_in: priceIn, price_out: priceOut, ...credits, updated_by: who, updated_at: new Date().toISOString() };
      let { error } = await db.from(table).upsert(row);
      // Sin la columna credits_period (falta la migración 0032) se guarda lo demás; solo "al día" funciona así
      if (error && feature === "fotos" && /credits_period/.test(error.message)) {
        delete row.credits_period;
        ({ error } = await db.from(table).upsert(row));
        if (!error && period !== "dia") return reply({ error: "Se guardó todo menos el periodo: falta aplicar la migración 0032 en Supabase. Mientras, los créditos siguen siendo al día." }, 400);
      }
      if (error) throw new Error(error.message);
      return reply(await list());
    }

    if (body.action === "prompts") {
      if (feature !== "fotos") return reply({ error: "Solo el Estudio de fotos tiene prompts." }, 400);
      const clean = (v: unknown) => String(v ?? "").trim().slice(0, 6000);
      const { error } = await db.from(table).upsert({ feature, prompt_keep: clean(body.promptKeep), prompt_remove: clean(body.promptRemove), updated_by: who, updated_at: new Date().toISOString() });
      if (error) throw new Error(/prompt_/.test(error.message) ? "Falta aplicar la migración 0031 en Supabase." : error.message);
      return reply(await list());
    }

    if (body.action === "quitar") {
      const { data: current } = await db.from(table).select("provider, key_cipher").eq("feature", feature).maybeSingle();
      const keys = readKeys(current as Pick<AiSettingRow, "provider" | "key_cipher"> | null);
      const provider = (info.providers.includes(body.provider as AiProvider) ? body.provider : current?.provider) as AiProvider | undefined;
      if (provider) delete keys[provider];
      const { error } = await db.from(table).update({ ...packKeys(keys), updated_by: who, updated_at: new Date().toISOString() }).eq("feature", feature);
      if (error) throw new Error(error.message);
      return reply(await list());
    }

    if (body.action === "probar") {
      const provider = info.providers.includes(body.provider as AiProvider) ? (body.provider as AiProvider) : undefined;
      const model = String(body.model || "").trim().slice(0, 80);
      const cfg = await getAiConfig(feature, provider && /^[a-z0-9.\-]+$/i.test(model) ? { provider, model } : undefined);
      if (!cfg) return reply({ error: "No hay ninguna clave para esta función." }, 400);
      if (provider && cfg.provider !== provider) return reply({ error: `No hay clave de ${PROVIDER_NAME[provider]} guardada. Pégala y toca Guardar.` }, 400);
      const started = Date.now();
      // OpenAI solo edita imágenes: se revisa que la clave abra el modelo, sin gastar
      if (cfg.provider === "openai") {
        await checkOpenAiModel(cfg);
        return reply({ ok: true, provider: cfg.provider, model: cfg.model, source: cfg.source, answer: "clave y modelo correctos", ms: Date.now() - started });
      }
      const r = await generateText(cfg, { system: "Responde en español con una sola palabra.", turns: [{ role: "user", text: "Di: listo" }], maxTokens: 50 });
      return reply({ ok: true, provider: cfg.provider, model: cfg.model, source: cfg.source, answer: r.text.slice(0, 60), ms: Date.now() - started });
    }
    return reply({ error: "Acción desconocida." }, 400);
  } catch (e) {
    return reply({ error: e instanceof AiFailure ? e.message : e instanceof Error ? e.message : "No se pudo." }, e instanceof AiFailure ? e.status : 500);
  }
}
