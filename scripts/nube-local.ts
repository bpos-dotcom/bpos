/**
 * Nube de Cloudflare en esta computadora, para probar B-POS completo contra
 * ella (sin tocar Supabase ni Cloudflare). SQLite en un archivo, archivos en
 * memoria y tiempo real con WebSocket.
 *
 *   npx tsx scripts/nube-local.ts [archivo.db]
 *   → http://localhost:4600/sb   (usuario prueba@bpos.local / prueba1234)
 *
 * Luego B-POS con NEXT_PUBLIC_SUPABASE_URL=http://localhost:4600/sb
 * (configuración "bpos-nube-local" de .claude/launch.json).
 */
import { createServer, type IncomingMessage } from "node:http";
import { existsSync } from "node:fs";
import { nodeDb } from "../nube/db";
import { schemaSql } from "../nube/tables";
import { createUser } from "../nube/auth";
import { handleNubeRequest, type NubeDeps } from "../nube/router";
import { handleStorage, type BucketLike } from "../nube/storage";
import { RealtimeHub, type HubSocket, type SocketState } from "../nube/realtime";

const PORT = 4600;

// ws viene con las dependencias del proyecto; se carga por nombre con tipos mínimos
type WebSocket = { readyState: number; send(t: string): void; on(ev: string, cb: (data?: unknown) => void): void };
type WssLike = { handleUpgrade(req: IncomingMessage, socket: unknown, head: unknown, cb: (ws: WebSocket) => void): void };
const file = process.argv[2] || "nube-local.db";

async function main() {
  const sqliteModule = "node:sqlite";
  const { DatabaseSync } = (await import(sqliteModule)) as { DatabaseSync: new (path: string) => { exec(sql: string): void } };
  const isNew = !existsSync(file);
  const sqlite = new DatabaseSync(file);
  sqlite.exec(schemaSql());
  const db = nodeDb(sqlite as never);

  const files = new Map<string, { data: Uint8Array; type?: string }>();
  const bucket: BucketLike = {
    async put(key, value, o) {
      files.set(key, { data: value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer), type: o?.httpMetadata?.contentType });
    },
    async get(key) {
      const f = files.get(key);
      return f ? { body: new Blob([f.data.slice().buffer as ArrayBuffer]).stream(), arrayBuffer: async () => f.data.slice().buffer as ArrayBuffer, httpMetadata: { contentType: f.type } } : null;
    },
    async head(key) {
      return files.has(key) ? {} : null;
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) files.delete(k);
    },
  };

  const sockets = new Set<{ ws: WebSocket; st: SocketState }>();
  const auth = { jwtSecret: "secreto-local-de-pruebas-1234567890", serviceKey: "nube-secreta-local", anonKey: "nube-publica-local", issuer: `http://localhost:${PORT}/sb/auth/v1` };
  const hubSockets = () =>
    [...sockets].map(
      (s): HubSocket => ({
        send: (t) => s.ws.readyState === 1 && s.ws.send(t),
        state: () => s.st,
        save: (st) => (s.st = st),
      })
    );
  const hub = new RealtimeHub({ db, jwtSecret: auth.jwtSecret, serviceKey: auth.serviceKey, sockets: hubSockets });
  const deps: NubeDeps = {
    db,
    base: "/sb",
    auth,
    blobs: bucket,
    onSyncHead: (b, seq) => hub.notifySyncHead(b, seq),
    broadcast: async (m) => hub.broadcast(m),
    storage: (request, path, a) => handleStorage(request, path, a, { db, bucket }),
  };

  if (isNew) {
    const u = await createUser(db, { email: "prueba@bpos.local", password: "prueba1234", confirmed: true });
    const uid = u.user!.id;
    const business = crypto.randomUUID();
    const branch = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.batch([
      { sql: "INSERT INTO businesses (id, name, owner_id, created_at, plan, plan_status, trial_ends_at) VALUES (?, 'Negocio de prueba (nube)', ?, ?, 'max', 'active', ?)", params: [business, uid, now, new Date(Date.now() + 30 * 86400e3).toISOString()] },
      { sql: "INSERT INTO branches (id, business_id, name, created_at) VALUES (?, ?, 'Centro', ?)", params: [branch, business, now] },
      { sql: "INSERT INTO business_members (business_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)", params: [business, uid, now] },
    ]);
    console.log("Negocio de prueba creado");
  }

  const server = createServer(async (req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const request = new Request(`http://localhost:${PORT}${req.url}`, { method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : body });
    const response = await handleNubeRequest(request, deps);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  const wsModule = "ws";
  const { WebSocketServer } = (await import(wsModule)) as { WebSocketServer: new (o: { noServer: boolean }) => WssLike };
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", `http://localhost:${PORT}`);
    if (url.pathname !== "/sb/realtime/v1/websocket") return void socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      const entry = { ws, st: { vsn: url.searchParams.get("vsn") === "2.0.0" ? "2.0.0" : "1.0.0", joins: [] } as SocketState };
      sockets.add(entry);
      const me = hubSockets().find((s) => s.state() === entry.st)!;
      ws.on("message", (data) => void hub.onMessage({ ...me, state: () => entry.st, save: (st) => (entry.st = st) }, String(data)));
      ws.on("close", () => sockets.delete(entry));
    });
  });
  server.listen(PORT, () => console.log(`Nube local en http://localhost:${PORT}/sb (${file})`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
