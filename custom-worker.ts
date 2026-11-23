/**
 * Entrada del worker de Cloudflare: lo que arma OpenNext (.open-next/worker.js)
 * más las tareas programadas que antes hacía el cron de Vercel (vercel.json).
 *   Lunes 14:00 UTC (8:00 en México) → /api/cron/asesor-semanal
 *
 * Nube de Cloudflare (mudanza fuera de Supabase, docs/mudanza-cloudflare.md):
 * si el Worker tiene la base D1 (NUBE_DB), todo lo que empieza con /sb lo
 * contesta la nube (nube/worker.ts). Sin esa base (el Worker de hoy, con
 * Supabase) no cambia nada.
 */
// @ts-ignore -- lo genera `opennextjs-cloudflare build`
import { default as handler } from "./.open-next/worker.js";
import { NUBE_BASE, handleNube, installInternalFetch, nubeEnabled, type NubeEnv } from "./nube/worker";

export { NubeRealtime } from "./nube/worker";

type Env = { CRON_SECRET?: string; NUBE_PUBLIC_URL?: string; NUBE_SERVICE_ROLE_KEY?: string } & NubeEnv & Record<string, unknown>;
type Ctx = { waitUntil(p: Promise<unknown>): void };

const CRONS: Record<string, string> = {
  "0 14 * * 1": "/api/cron/asesor-semanal",
};

/**
 * Llave de servidor de la nube de Cloudflare: en producción se guarda como
 * NUBE_SERVICE_ROLE_KEY para no pisar la de Supabase (SUPABASE_SERVICE_ROLE_KEY,
 * que se queda para poder regresar). Con la nube prendida, el servidor de
 * B-POS y la nube usan la de Cloudflare.
 */
function useNubeServiceKey(env: Env) {
  const key = env.NUBE_SERVICE_ROLE_KEY;
  if (typeof key === "string" && key && env.NUBE_DB) {
    // La de Supabase se guarda aparte: con ella están cifradas las claves de IA (lib/ai/settings.ts)
    const original = env.SUPABASE_SERVICE_ROLE_KEY;
    if (typeof original === "string" && original && original !== key && !env.SUPABASE_ORIGINAL_SERVICE_ROLE_KEY) {
      env.SUPABASE_ORIGINAL_SERVICE_ROLE_KEY = original;
      if (typeof process !== "undefined" && process.env) process.env.SUPABASE_ORIGINAL_SERVICE_ROLE_KEY = original;
    }
    env.SUPABASE_SERVICE_ROLE_KEY = key;
    if (typeof process !== "undefined" && process.env) process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  }
}

/** Direcciones con las que el propio servidor llama a la nube (supabase-js): la pública de la compilación y la de esta petición */
function nubeUrls(env: Env, request?: Request) {
  return [env.NUBE_PUBLIC_URL || "", request ? `${new URL(request.url).origin}${NUBE_BASE}` : ""];
}

export default {
  async fetch(request: Request, env: Env, ctx: Ctx) {
    useNubeServiceKey(env);
    if (nubeEnabled(env)) {
      installInternalFetch(env, nubeUrls(env, request));
      const path = new URL(request.url).pathname;
      if (path === NUBE_BASE || path.startsWith(`${NUBE_BASE}/`)) return handleNube(request, env, ctx);
    }
    return handler.fetch(request, env, ctx);
  },
  async scheduled(event: { cron: string }, env: Env, ctx: Ctx) {
    useNubeServiceKey(env);
    const path = CRONS[event.cron];
    if (!path) return;
    if (nubeEnabled(env)) installInternalFetch(env, nubeUrls(env));
    const headers: Record<string, string> = {};
    if (env.CRON_SECRET) headers.authorization = `Bearer ${env.CRON_SECRET}`;
    const request = new Request(`https://www.bpos.com.mx${path}`, { headers });
    ctx.waitUntil(handler.fetch(request, env, ctx));
  },
};
