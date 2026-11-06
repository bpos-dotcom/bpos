/**
 * Motor de IA de B-POS: la misma petición con Claude (Anthropic) o con
 * Gemini (Google), según lo que el dueño eligió para cada función
 * (lib/ai/settings.ts). Regresa también lo que costó para el presupuesto.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { AiConfig } from "@/lib/ai/settings";

export type AiPart = { type: "text"; text: string } | { type: "image"; mediaType: string; data: string } | { type: "pdf"; data: string };
export type AiUsage = { input: number; output: number };
export type AiTurn = { role: "user" | "assistant"; text: string };

export class AiFailure extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

export const aiCost = (cfg: Pick<AiConfig, "priceIn" | "priceOut">, u: AiUsage) => Math.round(((u.input * cfg.priceIn + u.output * cfg.priceOut) / 1_000_000) * 1_000_000) / 1_000_000;

const effortFor = (model: string) => /claude-(opus|sonnet)-5/.test(model);

function friendly(cfg: AiConfig, error: unknown): AiFailure {
  if (error instanceof AiFailure) return error;
  const who = cfg.provider === "gemini" ? "Gemini" : cfg.provider === "openai" ? "OpenAI" : "Claude";
  if (error instanceof Anthropic.AuthenticationError) return new AiFailure("La clave de Claude no es válida.");
  if (error instanceof Anthropic.RateLimitError) return new AiFailure("Demasiadas solicitudes seguidas. Espera un minuto y vuelve a intentar.", 429);
  if (error instanceof Anthropic.BadRequestError && /credit|balance|billing/i.test(error.message)) return new AiFailure("La cuenta de Anthropic no tiene saldo.");
  if (error instanceof Anthropic.APIError) return new AiFailure(`Error de ${who} (${error.status}): ${error.message}`);
  return new AiFailure(error instanceof Error ? `${who}: ${error.message}` : `Error desconocido con ${who}.`);
}

// ------------------------------------------------------------ Gemini

type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

type GeminiImage = { mimeType: string; data: string };

async function gemini(cfg: AiConfig, body: object): Promise<{ text: string; images: GeminiImage[]; finish: string; usage: AiUsage }> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": cfg.key },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; status?: string };
    candidates?: {
      content?: { parts?: { text?: string; inlineData?: GeminiImage; inline_data?: { mime_type?: string; data?: string } }[] };
      finishReason?: string;
    }[];
    promptFeedback?: { blockReason?: string };
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  };
  if (!res.ok) {
    const msg = json.error?.message || `HTTP ${res.status}`;
    if (res.status === 400 && /API key/i.test(msg)) throw new AiFailure("La clave de Gemini no es válida.");
    if (res.status === 429) throw new AiFailure("Gemini: se acabó la cuota o hay demasiadas solicitudes. Espera un minuto.", 429);
    throw new AiFailure(`Error de Gemini (${res.status}): ${msg}`);
  }
  const c = json.candidates?.[0];
  const u = json.usageMetadata || {};
  return {
    text: (c?.content?.parts || []).map((p) => p.text || "").join(""),
    // Los modelos de imagen regresan la foto como datos en base64
    images: (c?.content?.parts || [])
      .map((p) => p.inlineData || (p.inline_data ? { mimeType: p.inline_data.mime_type || "image/png", data: p.inline_data.data || "" } : null))
      .filter((img): img is GeminiImage => Boolean(img?.data)),
    finish: json.promptFeedback?.blockReason ? "SAFETY" : c?.finishReason || "",
    usage: { input: u.promptTokenCount || 0, output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) },
  };
}

const geminiParts = (parts: AiPart[]): GeminiPart[] =>
  parts.map((p) => (p.type === "text" ? { text: p.text } : { inline_data: { mime_type: p.type === "pdf" ? "application/pdf" : p.mediaType, data: p.data } }));

// ------------------------------------------------------------ respuesta con forma (JSON)

/**
 * Pide una respuesta con la forma de `schema`. `refusal`: el modelo no quiso
 * o no pudo; `truncated`: se cortó por largo.
 */
export async function generateJson<T>(
  cfg: AiConfig,
  opts: { system: string; parts: AiPart[]; schema: z.ZodType<T>; maxTokens: number; effort?: "low" | "medium" | "high" }
): Promise<{ data: T | null; refusal: boolean; truncated: boolean; usage: AiUsage }> {
  try {
    if (cfg.provider === "gemini") {
      const r = await gemini(cfg, {
        systemInstruction: { parts: [{ text: `${opts.system}\n\nResponde SOLO con un JSON que cumpla este esquema:\n${JSON.stringify(z.toJSONSchema(opts.schema))}` }] },
        contents: [{ role: "user", parts: geminiParts(opts.parts) }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: opts.maxTokens },
      });
      if (r.finish === "SAFETY" || r.finish === "PROHIBITED_CONTENT") return { data: null, refusal: true, truncated: false, usage: r.usage };
      if (r.finish === "MAX_TOKENS") return { data: null, refusal: false, truncated: true, usage: r.usage };
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(r.text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
      } catch {
        return { data: null, refusal: false, truncated: false, usage: r.usage };
      }
      const check = opts.schema.safeParse(parsed);
      return { data: check.success ? check.data : null, refusal: false, truncated: false, usage: r.usage };
    }

    const content: Anthropic.Beta.BetaContentBlockParam[] = opts.parts.map((p) =>
      p.type === "text"
        ? { type: "text", text: p.text }
        : p.type === "pdf"
          ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: p.data } }
          : { type: "image", source: { type: "base64", media_type: p.mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: p.data } }
    );
    const opus = cfg.model === "claude-opus-5-5";
    const response = await new Anthropic({ apiKey: cfg.key, maxRetries: 2, timeout: 5 * 60 * 1000 }).beta.messages.parse({
      model: cfg.model,
      max_tokens: opts.maxTokens,
      ...(opus ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      output_config: { ...(effortFor(cfg.model) ? { effort: opts.effort || "medium" } : {}), format: betaZodOutputFormat(opts.schema) },
      system: opts.system,
      messages: [{ role: "user", content }],
    });
    const usage = { input: (response.usage.input_tokens || 0) + (response.usage.cache_creation_input_tokens || 0), output: response.usage.output_tokens || 0 };
    return { data: (response.parsed_output as T | null) ?? null, refusal: response.stop_reason === "refusal", truncated: response.stop_reason === "max_tokens", usage };
  } catch (error) {
    throw friendly(cfg, error);
  }
}

// ------------------------------------------------------------ conversación (texto)

export async function generateText(cfg: AiConfig, opts: { system: string; turns: AiTurn[]; maxTokens: number }): Promise<{ text: string; usage: AiUsage }> {
  try {
    if (cfg.provider === "gemini") {
      const r = await gemini(cfg, {
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: opts.turns.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.text }] })),
        generationConfig: { maxOutputTokens: opts.maxTokens },
      });
      if (r.finish === "SAFETY" || r.finish === "PROHIBITED_CONTENT") throw new AiFailure("El asesor no pudo responder eso.", 422);
      return { text: r.text.trim(), usage: r.usage };
    }
    const response = await new Anthropic({ apiKey: cfg.key, maxRetries: 2, timeout: 3 * 60 * 1000 }).messages.create({
      model: cfg.model,
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages: opts.turns.map((t) => ({ role: t.role, content: t.text })),
    });
    const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    return { text, usage: { input: response.usage.input_tokens || 0, output: response.usage.output_tokens || 0 } };
  } catch (error) {
    throw friendly(cfg, error);
  }
}

// ------------------------------------------------------------ imagen (Estudio de fotos)

const OPENAI = "https://api.openai.com/v1";

type OpenAiError = { error?: { message?: string; code?: string | null; type?: string } };

function openAiFailure(status: number, json: OpenAiError) {
  const msg = json.error?.message || `HTTP ${status}`;
  if (status === 401) return new AiFailure("La clave de OpenAI no es válida.");
  if (status === 429) return new AiFailure(/quota|billing/i.test(msg) ? "La cuenta de OpenAI no tiene saldo." : "OpenAI: demasiadas solicitudes. Espera un minuto.", 429);
  if (status === 403 && /verif/i.test(msg)) return new AiFailure("OpenAI pide verificar la organización para usar este modelo (platform.openai.com → Settings → Organization).", 403);
  if (status === 404) return new AiFailure("Ese modelo de OpenAI no existe o tu cuenta no lo tiene.", 404);
  return new AiFailure(`Error de OpenAI (${status}): ${msg}`);
}

/** Revisa que la clave de OpenAI abra el modelo (sin generar nada ni gastar). */
export async function checkOpenAiModel(cfg: AiConfig) {
  const res = await fetch(`${OPENAI}/models/${encodeURIComponent(cfg.model)}`, { headers: { Authorization: `Bearer ${cfg.key}` } });
  if (!res.ok) throw openAiFailure(res.status, (await res.json().catch(() => ({}))) as OpenAiError);
}

/**
 * Edita una foto con la API de imágenes de OpenAI (gpt-image-1): calidad
 * media y fidelidad alta a la foto que se manda (no cambia el platillo).
 */
async function openAiEdit(cfg: AiConfig, opts: { prompt: string; image: { mediaType: string; data: string }; transparent?: boolean }) {
  const form = new FormData();
  form.append("model", cfg.model);
  form.append("prompt", opts.prompt);
  const ext = opts.image.mediaType.split("/")[1] || "jpeg";
  form.append("image", new Blob([Buffer.from(opts.image.data, "base64")], { type: opts.image.mediaType }), `foto.${ext}`);
  form.append("size", "auto");
  form.append("quality", "medium");
  // gpt-image-1 respeta más los detalles de la foto original con fidelidad alta
  if (cfg.model === "gpt-image-1") form.append("input_fidelity", "high");
  // Quitar fondo: PNG con transparencia real (el prompt solo no la garantiza)
  if (opts.transparent) {
    form.append("background", "transparent");
    form.append("output_format", "png");
  }
  const res = await fetch(`${OPENAI}/images/edits`, { method: "POST", headers: { Authorization: `Bearer ${cfg.key}` }, body: form });
  const json = (await res.json().catch(() => ({}))) as OpenAiError & {
    data?: { b64_json?: string }[];
    output_format?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  if (!res.ok) {
    // La revisión de contenido de OpenAI rechazó la foto
    if (res.status === 400 && /moderation|safety/i.test(`${json.error?.code} ${json.error?.message}`)) {
      return { image: null, refusal: true, text: json.error?.message || "", usage: { input: 0, output: 0 } };
    }
    throw openAiFailure(res.status, json);
  }
  const data = json.data?.[0]?.b64_json || "";
  return {
    image: data ? { mimeType: `image/${json.output_format || "png"}`, data } : null,
    refusal: false,
    text: "",
    usage: { input: json.usage?.input_tokens || 0, output: json.usage?.output_tokens || 0 },
  };
}

/**
 * Edita una foto con un modelo de imagen (OpenAI gpt-image-1 o Gemini
 * gemini-2.5-flash-image): regresa la imagen nueva en base64. `refusal`: el
 * modelo no quiso editarla.
 */
export async function editImage(
  cfg: AiConfig,
  opts: { prompt: string; image: { mediaType: string; data: string }; transparent?: boolean }
): Promise<{ image: GeminiImage | null; refusal: boolean; text: string; usage: AiUsage }> {
  if (cfg.provider !== "gemini" && cfg.provider !== "openai") throw new AiFailure("El Estudio de fotos funciona con OpenAI o Gemini.", 400);
  try {
    if (cfg.provider === "openai") return await openAiEdit(cfg, opts);
    const r = await gemini(cfg, {
      contents: [{ role: "user", parts: [{ inline_data: { mime_type: opts.image.mediaType, data: opts.image.data } }, { text: opts.prompt }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    });
    const refusal = r.finish === "SAFETY" || r.finish === "PROHIBITED_CONTENT" || r.finish === "IMAGE_SAFETY";
    return { image: r.images[0] || null, refusal, text: r.text.trim(), usage: r.usage };
  } catch (error) {
    throw friendly(cfg, error);
  }
}
