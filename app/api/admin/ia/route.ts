import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/client";
import { AiFailure, generateText } from "@/lib/ai/engine";
import { FEATURES, MODELS, adminDb, getAiConfig, packKeys, readHints, readKeys, type AiFeature, type AiProvider, type AiSettingRow } from "@/lib/ai/settings";

/**
 * Configuración → Administrador → Claves de IA (solo administradores de la
 * plataforma, is_platform_admin):
 *   GET                                   → funciones, proveedor, modelo, últimos 4 de cada clave
 *   POST { action: "guardar", feature, provider, model, key?, priceIn, priceOut }
 *   POST { action: "probar", feature, provider?, model? } → una pregunta corta (lo elegido, aunque no esté guardado)
 *   POST { action: "quitar", feature, provider } → borra la clave de ese proveedor
 * Se guarda una clave por proveedor: cambiar de Gemini a Claude no borra la
 * de Gemini. La clave nunca regresa al navegador.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reply = (body: object, status = 200) => NextResponse.json(body, { status });

async function requireAdmin(request: NextRequest) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const [{ data: user }, { data: isAdmin }] = await Promise.all([db.auth.getUser(token), db.rpc("is_platform_admin")]);
  return user.user && isAdmin === true ? user.user.email || user.user.id : null;
}

async function list() {
  const { data } = await adminDb().from("bpos_ai_settings").select("feature, provider, model, key_hint, price_in, price_out, updated_by, updated_at");
  const rows = (data || []) as Omit<AiSettingRow, "key_cipher">[];
  const vercel = Boolean(process.env.ANTHROPIC_API_KEY);
  return {
    models: MODELS,
    vercelFallback: vercel,
    features: FEATURES.map((f) => {
      const r = rows.find((x) => x.feature === f.id);
      const provider = r?.provider || "anthropic";
      const model = r?.model || "claude-opus-5-5";
      const hints = readHints(r || null);
      const own = Boolean(hints[provider]);
      return {
        ...f,
        provider,
        model,
        keyHints: hints,
        // Lo que de verdad se usa (Gemini sin clave regresa a Claude Opus de Vercel)
        running: own ? { provider, model } : vercel ? { provider: "anthropic", model: provider === "anthropic" ? model : "claude-opus-5-5" } : null,
        priceIn: r ? Number(r.price_in) : 4,
        priceOut: r ? Number(r.price_out) : 20,
        updatedBy: r?.updated_by || "",
        updatedAt: r?.updated_at || "",
        active: own ? "admin" : vercel ? "vercel" : "ninguna",
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
  if (!FEATURES.some((f) => f.id === feature)) return reply({ error: "Función desconocida." }, 400);
  const db = adminDb();

  try {
    if (body.action === "guardar") {
      const provider = body.provider as AiProvider;
      if (provider !== "anthropic" && provider !== "gemini") return reply({ error: "Proveedor desconocido." }, 400);
      const model = String(body.model || "").trim().slice(0, 80);
      if (!/^[a-z0-9.\-]+$/i.test(model)) return reply({ error: "Escribe el modelo (ej. gemini-2.5-flash-lite)." }, 400);
      const key = String(body.key || "").trim();
      const priceIn = Math.max(0, Number(body.priceIn) || 0);
      const priceOut = Math.max(0, Number(body.priceOut) || 0);
      const { data: current } = await db.from("bpos_ai_settings").select("provider, key_cipher").eq("feature", feature).maybeSingle();
      const keys = readKeys(current as Pick<AiSettingRow, "provider" | "key_cipher"> | null);
      if (key && key.length < 20) return reply({ error: "La clave se ve incompleta." }, 400);
      if (key) keys[provider] = key;
      // Sin clave guardada de ese proveedor se pide (Claude puede usar la de Vercel)
      if (!keys[provider] && !(provider === "anthropic" && process.env.ANTHROPIC_API_KEY)) return reply({ error: `Pega la clave de ${provider === "gemini" ? "Google (Gemini)" : "Anthropic (Claude)"}.` }, 400);
      const { error } = await db.from("bpos_ai_settings").upsert({
        feature,
        provider,
        model,
        ...packKeys(keys),
        price_in: priceIn,
        price_out: priceOut,
        updated_by: who,
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
      return reply(await list());
    }

    if (body.action === "quitar") {
      const { data: current } = await db.from("bpos_ai_settings").select("provider, key_cipher").eq("feature", feature).maybeSingle();
      const keys = readKeys(current as Pick<AiSettingRow, "provider" | "key_cipher"> | null);
      const provider = (body.provider === "gemini" || body.provider === "anthropic" ? body.provider : current?.provider) as AiProvider | undefined;
      if (provider) delete keys[provider];
      const { error } = await db.from("bpos_ai_settings").update({ ...packKeys(keys), updated_by: who, updated_at: new Date().toISOString() }).eq("feature", feature);
      if (error) throw new Error(error.message);
      return reply(await list());
    }

    if (body.action === "probar") {
      const provider = body.provider === "gemini" || body.provider === "anthropic" ? (body.provider as AiProvider) : undefined;
      const model = String(body.model || "").trim().slice(0, 80);
      const cfg = await getAiConfig(feature, provider && /^[a-z0-9.\-]+$/i.test(model) ? { provider, model } : undefined);
      if (!cfg) return reply({ error: "No hay ninguna clave para esta función." }, 400);
      if (provider && cfg.provider !== provider) return reply({ error: `No hay clave de ${provider === "gemini" ? "Gemini" : "Claude"} guardada. Pégala y toca Guardar.` }, 400);
      const started = Date.now();
      const r = await generateText(cfg, { system: "Responde en español con una sola palabra.", turns: [{ role: "user", text: "Di: listo" }], maxTokens: 50 });
      return reply({ ok: true, provider: cfg.provider, model: cfg.model, source: cfg.source, answer: r.text.slice(0, 60), ms: Date.now() - started });
    }
    return reply({ error: "Acción desconocida." }, 400);
  } catch (e) {
    return reply({ error: e instanceof AiFailure ? e.message : e instanceof Error ? e.message : "No se pudo." }, e instanceof AiFailure ? e.status : 500);
  }
}
