/**
 * Entrada de la nube: recibe la petición de supabase-js (o del Agent) bajo
 * /sb/... y la manda a REST, RPC, Auth, Storage o Realtime. No depende de
 * Cloudflare: el Worker (nube/worker.ts) y las pruebas le pasan la base de
 * datos y las llaves.
 */
import type { Db, Row } from "./db";
import { authFromRequest, handleAuth, type AuthEnv } from "./auth";
import { errorReply, handleRest, type NubeCtx, type Reply } from "./rest";
import { RestError } from "./postgrest";
import { handleRpc } from "./rpc";

export type NubeDeps = {
  db: Db;
  auth: AuthEnv;
  /** Prefijo de la nube en la dirección ("/sb") */
  base: string;
  onSyncHead?: NubeCtx["onSyncHead"];
  /** Aviso de broadcast al Agent (realtime) */
  broadcast?: (messages: { topic: string; event: string; payload: unknown }[]) => Promise<void>;
  /** Archivos (R2) */
  storage?: (request: Request, path: string, auth: Awaited<ReturnType<typeof authFromRequest>>) => Promise<Response>;
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, HEAD, OPTIONS",
  "access-control-allow-headers": "authorization, apikey, content-type, prefer, accept, accept-profile, content-profile, range, x-client-info, x-supabase-api-version, x-region",
  "access-control-expose-headers": "content-range, x-supabase-api-version",
  "access-control-max-age": "86400",
};

const toResponse = (r: Reply) => new Response(r.body, { status: r.status, headers: { ...CORS, ...r.headers } });

async function readBody(request: Request): Promise<unknown> {
  if (request.method === "GET" || request.method === "HEAD") return null;
  const text = await request.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new RestError(400, "PGRST102", "Empty or invalid json");
  }
}

export async function handleNubeRequest(request: Request, deps: NubeDeps): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(request.url);
  const path = url.pathname.startsWith(deps.base) ? url.pathname.slice(deps.base.length) : url.pathname;
  try {
    const auth = await authFromRequest(request.headers, deps.auth);

    if (path.startsWith("/auth/v1")) {
      const body = ((await readBody(request)) || {}) as Row;
      return toResponse(await handleAuth(deps.db, deps.auth, auth, request.method, path.slice("/auth/v1".length) || "/", url.searchParams, body));
    }

    if (path.startsWith("/rest/v1/rpc/")) {
      const fn = decodeURIComponent(path.slice("/rest/v1/rpc/".length));
      const body = request.method === "GET" ? Object.fromEntries(url.searchParams) : ((await readBody(request)) || {});
      return toResponse(await handleRpc({ db: deps.db, auth, onSyncHead: deps.onSyncHead, broadcast: deps.broadcast, authEnv: deps.auth }, fn, body as Row, request.headers));
    }

    if (path.startsWith("/rest/v1/")) {
      const table = decodeURIComponent(path.slice("/rest/v1/".length).split("/")[0]);
      return toResponse(await handleRest({ db: deps.db, auth, onSyncHead: deps.onSyncHead }, { method: request.method, table, params: url.searchParams, headers: request.headers, body: await readBody(request) }));
    }

    if (path === "/realtime/v1/api/broadcast" && request.method === "POST") {
      if (auth.role === "anon" && request.headers.get("apikey") !== deps.auth.anonKey) return toResponse({ status: 401, headers: {}, body: null });
      const body = (await readBody(request)) as { messages?: { topic: string; event: string; payload: unknown }[] } | null;
      await deps.broadcast?.(Array.isArray(body?.messages) ? body!.messages.slice(0, 100) : []);
      return new Response(null, { status: 202, headers: CORS });
    }

    if (path.startsWith("/storage/v1/") && deps.storage) {
      const res = await deps.storage(request, path.slice("/storage/v1".length), auth);
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
      return new Response(res.body, { status: res.status, headers });
    }

    return toResponse({ status: 404, headers: { "content-type": "application/json" }, body: JSON.stringify({ message: `No existe ${path} en la nube` }) });
  } catch (e) {
    return toResponse(errorReply(e));
  }
}
