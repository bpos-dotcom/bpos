/**
 * La nube dentro del Worker de Cloudflare: conecta el router (router.ts) con
 * D1 (NUBE_DB), R2 (NUBE_FILES) y el Durable Object de tiempo real
 * (NUBE_REALTIME). custom-worker.ts manda aquí todo lo que empieza con /sb.
 *
 * El servidor de B-POS (rutas /api) también usa supabase-js con la dirección
 * de la nube: `installInternalFetch` contesta esas llamadas aquí mismo, sin
 * salir a internet (un Worker no puede llamarse a sí mismo por su dominio).
 */
import { d1Db, type D1Like } from "./db";
import { handleNubeRequest, type NubeDeps } from "./router";
import { handleStorage, type BucketLike } from "./storage";
import { RealtimeHub, type HubSocket, type SocketState } from "./realtime";

export const NUBE_BASE = "/sb";

type StubLike = { fetch(input: string | Request, init?: RequestInit): Promise<Response> };
type NamespaceLike = { idFromName(name: string): unknown; get(id: unknown): StubLike };
type CtxLike = { waitUntil(p: Promise<unknown>): void };

export type NubeEnv = {
  NUBE_DB?: D1Like;
  NUBE_FILES?: BucketLike;
  NUBE_REALTIME?: NamespaceLike;
  NUBE_JWT_SECRET?: string;
  NUBE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  NUBE_ISSUER?: string;
};

/** ¿Este Worker tiene la nube prendida? (la versión aparte sí; la de Supabase no) */
export const nubeEnabled = (env: NubeEnv) => Boolean(env.NUBE_DB && env.NUBE_JWT_SECRET && env.SUPABASE_SERVICE_ROLE_KEY && env.NUBE_ANON_KEY);

const realtimeStub = (env: NubeEnv) => env.NUBE_REALTIME?.get(env.NUBE_REALTIME.idFromName("global"));

function deps(env: NubeEnv, ctx: CtxLike | null): NubeDeps {
  const db = d1Db(env.NUBE_DB!);
  const stub = realtimeStub(env);
  const later = (p: Promise<unknown>) => (ctx ? ctx.waitUntil(p.catch(() => undefined)) : void p.catch(() => undefined));
  return {
    db,
    base: NUBE_BASE,
    auth: { jwtSecret: env.NUBE_JWT_SECRET!, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY!, anonKey: env.NUBE_ANON_KEY!, issuer: env.NUBE_ISSUER || "nube-bpos" },
    onSyncHead: (businessId, seq) => {
      if (stub) later(stub.fetch("https://realtime/notify", { method: "POST", body: JSON.stringify({ businessId, seq }) }));
    },
    broadcast: async (messages) => {
      if (stub && messages.length) later(stub.fetch("https://realtime/broadcast", { method: "POST", body: JSON.stringify({ messages }) }));
    },
    storage: env.NUBE_FILES ? (request, path, auth) => handleStorage(request, path, auth, { db, bucket: env.NUBE_FILES! }) : undefined,
  };
}

export async function handleNube(request: Request, env: NubeEnv, ctx: CtxLike | null): Promise<Response> {
  if (!nubeEnabled(env)) return new Response(JSON.stringify({ message: "La nube de Cloudflare no está prendida en este Worker." }), { status: 503, headers: { "content-type": "application/json" } });
  const url = new URL(request.url);
  // Tiempo real: el socket lo atiende el Durable Object
  if (url.pathname === `${NUBE_BASE}/realtime/v1/websocket`) {
    const stub = realtimeStub(env);
    if (!stub || request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Se esperaba un WebSocket", { status: 426 });
    return stub.fetch(`https://realtime/ws?vsn=${encodeURIComponent(url.searchParams.get("vsn") || "1.0.0")}`, request);
  }
  return handleNubeRequest(request, deps(env, ctx));
}

/** Las llamadas de supabase-js del propio servidor a la nube se contestan aquí mismo */
export function installInternalFetch(env: NubeEnv, publicUrls: string[]) {
  const g = globalThis as unknown as { fetch: typeof fetch; __nubeFetchInstalled?: boolean };
  if (g.__nubeFetchInstalled || !nubeEnabled(env)) return;
  g.__nubeFetchInstalled = true;
  const original = g.fetch.bind(globalThis);
  const bases = publicUrls.map((u) => u.replace(/\/$/, "")).filter(Boolean);
  g.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (bases.some((b) => url === b || url.startsWith(`${b}/`)) && !/\/realtime\/v1\/websocket/.test(url)) {
      const request = input instanceof Request && !init ? input : new Request(url, init ?? (input instanceof Request ? input : undefined));
      return handleNube(request, env, null);
    }
    return original(input as RequestInfo, init);
  }) as typeof fetch;
}

// ------------------------------------------------------------ Durable Object de tiempo real

type WsLike = { send(text: string): void; serializeAttachment(v: unknown): void; deserializeAttachment(): unknown; close(code?: number, reason?: string): void; accept?: () => void };
type DoState = { acceptWebSocket(ws: WsLike): void; getWebSockets(): WsLike[] };
declare const WebSocketPair: { new (): { 0: WsLike; 1: WsLike } };

export class NubeRealtime {
  private hub: RealtimeHub;
  private wrapped = new WeakMap<WsLike, HubSocket>();

  constructor(
    private state: DoState,
    env: NubeEnv
  ) {
    this.hub = new RealtimeHub({
      db: d1Db(env.NUBE_DB!),
      jwtSecret: env.NUBE_JWT_SECRET || "",
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || "",
      sockets: () => this.state.getWebSockets().map((ws) => this.wrap(ws)),
    });
  }

  private wrap(ws: WsLike): HubSocket {
    let s = this.wrapped.get(ws);
    if (!s) {
      s = {
        send: (text) => {
          try {
            ws.send(text);
          } catch {
            // socket cerrado
          }
        },
        state: () => (ws.deserializeAttachment() as SocketState | null) || { vsn: "2.0.0", joins: [] },
        save: (st) => ws.serializeAttachment(st),
      };
      this.wrapped.set(ws, s);
    }
    return s;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.state.acceptWebSocket(server);
      server.serializeAttachment({ vsn: url.searchParams.get("vsn") === "2.0.0" ? "2.0.0" : "1.0.0", joins: [] } satisfies SocketState);
      return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: WsLike });
    }
    const body = (await request.json().catch(() => ({}))) as { businessId?: string; seq?: number; messages?: { topic: string; event: string; payload: unknown }[] };
    if (url.pathname === "/notify" && body.businessId) this.hub.notifySyncHead(body.businessId, Number(body.seq) || 0);
    if (url.pathname === "/broadcast" && Array.isArray(body.messages)) this.hub.broadcast(body.messages);
    return new Response(null, { status: 204 });
  }

  async webSocketMessage(ws: WsLike, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;
    await this.hub.onMessage(this.wrap(ws), message);
  }

  async webSocketClose(ws: WsLike, code: number) {
    try {
      ws.close(code, "adiós");
    } catch {
      // ya estaba cerrado
    }
  }
}
