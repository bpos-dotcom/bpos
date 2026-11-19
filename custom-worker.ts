/**
 * Entrada del worker de Cloudflare: lo que arma OpenNext (.open-next/worker.js)
 * más las tareas programadas que antes hacía el cron de Vercel (vercel.json).
 *   Lunes 14:00 UTC (8:00 en México) → /api/cron/asesor-semanal
 */
// @ts-ignore -- lo genera `opennextjs-cloudflare build`
import { default as handler } from "./.open-next/worker.js";

type Env = { CRON_SECRET?: string } & Record<string, unknown>;
type Ctx = { waitUntil(p: Promise<unknown>): void };

const CRONS: Record<string, string> = {
  "0 14 * * 1": "/api/cron/asesor-semanal",
};

export default {
  fetch: handler.fetch,
  async scheduled(event: { cron: string }, env: Env, ctx: Ctx) {
    const path = CRONS[event.cron];
    if (!path) return;
    const headers: Record<string, string> = {};
    if (env.CRON_SECRET) headers.authorization = `Bearer ${env.CRON_SECRET}`;
    const request = new Request(`https://www.bpos.com.mx${path}`, { headers });
    ctx.waitUntil(handler.fetch(request, env, ctx));
  },
};
