/**
 * Tiempo real y archivos de la nube de Cloudflare:
 *  - Una caja (supabase-js, vsn 2.0.0) escucha sync_heads de su negocio y le
 *    llega el aviso; la de otro negocio no puede escuchar.
 *  - El Agent (vsn 1.0.0) recibe el "toque" cuando hay trabajo.
 *  - Fotos: se suben dentro de la carpeta del negocio y se ven públicas.
 *   npx tsx scripts/test-nube-realtime.ts
 */
import { RealtimeHub, type HubSocket, type SocketState } from "../nube/realtime";
import { handleStorage, type BucketLike } from "../nube/storage";
import { checker, makeHarness, seedBusiness, SERVICE } from "./nube-harness";

const { check, done } = checker();

class FakeSocket implements HubSocket {
  sent: string[] = [];
  private st: SocketState;
  constructor(vsn: SocketState["vsn"]) {
    this.st = { vsn, joins: [] };
  }
  send(text: string) {
    this.sent.push(text);
  }
  state() {
    return JSON.parse(JSON.stringify(this.st)) as SocketState;
  }
  save(s: SocketState) {
    this.st = s;
  }
  last() {
    return JSON.parse(this.sent[this.sent.length - 1] || "null");
  }
}

function memoryBucket(): BucketLike & { map: Map<string, { data: Uint8Array; type?: string; cache?: string }> } {
  const map = new Map<string, { data: Uint8Array; type?: string; cache?: string }>();
  return {
    map,
    async put(key, value, options) {
      const data = value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer);
      map.set(key, { data, type: options?.httpMetadata?.contentType, cache: options?.httpMetadata?.cacheControl });
    },
    async get(key) {
      const o = map.get(key);
      if (!o) return null;
      return { body: new Blob([o.data.slice().buffer as ArrayBuffer]).stream(), arrayBuffer: async () => o.data.buffer as ArrayBuffer, httpMetadata: { contentType: o.type, cacheControl: o.cache } };
    },
    async head(key) {
      return map.has(key) ? {} : null;
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) map.delete(k);
    },
  };
}

async function main() {
  const h = await makeHarness();
  const a = await seedBusiness(h, "dueno@prueba.mx");
  const b = await seedBusiness(h, "otro@prueba.mx");
  const sa = await h.signIn("dueno@prueba.mx", "secreta123");
  const tokenA = (await sa.auth.getSession()).data.session!.access_token;

  const sockets: FakeSocket[] = [];
  const hub = new RealtimeHub({ db: h.db, jwtSecret: h.deps.auth.jwtSecret, serviceKey: SERVICE, sockets: () => sockets });

  // ---------------------------------------------------------------- caja (supabase-js, vsn 2.0.0)
  const caja = new FakeSocket("2.0.0");
  sockets.push(caja);
  const topic = `realtime:sync-${a.businessId}-dev1`;
  const join = ["1", "1", topic, "phx_join", { config: { broadcast: { ack: false, self: false }, presence: { key: "", enabled: false }, postgres_changes: [{ event: "*", schema: "public", table: "sync_heads", filter: `business_id=eq.${a.businessId}` }], private: false }, access_token: tokenA }];
  await hub.onMessage(caja, JSON.stringify(join));
  const reply = caja.last();
  const pgId = reply?.[4]?.response?.postgres_changes?.[0]?.id;
  check("la caja entra al canal y recibe el id de su filtro", reply?.[3] === "phx_reply" && reply[4].status === "ok" && typeof pgId === "number", reply);
  check("el filtro que regresa es el mismo que pidió", reply?.[4]?.response?.postgres_changes?.[0]?.filter === `business_id=eq.${a.businessId}`);
  await hub.onMessage(caja, JSON.stringify([null, "2", "phoenix", "heartbeat", {}]));
  check("latido (heartbeat) contestado", caja.last()?.[3] === "phx_reply" && caja.last()?.[1] === "2");

  hub.notifySyncHead(a.businessId, 42);
  const change = caja.last();
  check("aviso de cambio con el formato de Supabase", change?.[3] === "postgres_changes" && change[4].ids.includes(pgId) && change[4].data.type === "UPDATE" && change[4].data.record.seq === "42", change);
  check("con las columnas para convertir el número", change?.[4]?.data?.columns?.some((c: { name: string; type: string }) => c.name === "seq" && c.type === "int8"));
  const before = caja.sent.length;
  hub.notifySyncHead(b.businessId, 7);
  check("el cambio de otro negocio no le llega", caja.sent.length === before);

  const espia = new FakeSocket("2.0.0");
  sockets.push(espia);
  await hub.onMessage(espia, JSON.stringify(["1", "1", `realtime:sync-${b.businessId}-x`, "phx_join", { config: { postgres_changes: [{ event: "*", schema: "public", table: "sync_heads", filter: `business_id=eq.${b.businessId}` }] }, access_token: tokenA }]));
  check("no puede escuchar a otro negocio", espia.last()?.[4]?.status === "error");
  await hub.onMessage(espia, JSON.stringify(["1", "1", "realtime:x", "phx_join", { config: { postgres_changes: [{ event: "*", schema: "public", table: "sync_records", filter: `business_id=eq.${a.businessId}` }] }, access_token: tokenA }]));
  check("ni otras tablas", espia.last()?.[4]?.status === "error");

  // ---------------------------------------------------------------- Agent (vsn 1.0.0)
  const agent = new FakeSocket("1.0.0");
  sockets.push(agent);
  await hub.onMessage(agent, JSON.stringify({ topic: "realtime:agent-abc", event: "phx_join", payload: { config: { broadcast: { self: false, ack: false }, presence: { key: "" }, private: false }, access_token: "nube-publica" }, ref: "1" }));
  check("el Agent entra a su canal", agent.last()?.event === "phx_reply" && agent.last()?.payload?.status === "ok", agent.last());
  hub.broadcast([{ topic: "agent-abc", event: "job", payload: {} }]);
  check("le llega el toque de trabajo (objeto, como espera el Agent)", agent.last()?.event === "broadcast" && agent.last()?.payload?.event === "job", agent.last());
  const n = agent.sent.length;
  hub.broadcast([{ topic: "agent-otro", event: "job", payload: {} }]);
  check("el toque de otro Agent no le llega", agent.sent.length === n);

  // El aviso por la dirección /realtime/v1/api/broadcast (lo usa la caja)
  const res = await (await import("../nube/router")).handleNubeRequest(
    new Request("http://nube.test/sb/realtime/v1/api/broadcast", { method: "POST", headers: { apikey: h.deps.auth.anonKey, authorization: `Bearer ${h.deps.auth.anonKey}`, "content-type": "application/json" }, body: JSON.stringify({ messages: [{ topic: "agent-abc", event: "job", payload: {} }] }) }),
    h.deps
  );
  check("broadcast por dirección (202)", res.status === 202 && h.broadcasts.at(-1)?.topic === "agent-abc", res.status);

  // ---------------------------------------------------------------- archivos (R2)
  const bucket = memoryBucket();
  h.deps.storage = (request, path, auth) => handleStorage(request, path, auth, { db: h.db, bucket });
  const img = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/webp" });
  const up = await sa.storage.from("bpos-media").upload(`${a.businessId}/productos/foto1.webp`, img, { contentType: "image/webp", cacheControl: "31536000" });
  check("sube la foto a su carpeta", !up.error && bucket.map.has(`bpos-media/${a.businessId}/productos/foto1.webp`), up.error);
  const url = sa.storage.from("bpos-media").getPublicUrl(`${a.businessId}/productos/foto1.webp`).data.publicUrl;
  check("dirección pública de la nube", url === `http://nube.test/sb/storage/v1/object/public/bpos-media/${a.businessId}/productos/foto1.webp`, url);
  const pub = await (await import("../nube/router")).handleNubeRequest(new Request(url), h.deps);
  check("la foto se ve sin sesión, con su tipo", pub.status === 200 && pub.headers.get("content-type") === "image/webp" && (await pub.arrayBuffer()).byteLength === 4, pub.status);
  const other = await sa.storage.from("bpos-media").upload(`${b.businessId}/productos/x.webp`, img);
  check("no sube en la carpeta de otro negocio", Boolean(other.error), other);
  const dupUp = await sa.storage.from("bpos-media").upload(`${a.businessId}/productos/foto1.webp`, img);
  check("no pisa una foto existente sin upsert", Boolean(dupUp.error));
  const svcUp = await h.client({ service: true }).storage.from("bpos-media").upload(`${b.businessId}/evidencias/e.webp`, img, { upsert: true });
  check("el servidor sube donde sea", !svcUp.error, svcUp.error);
  const rm = await sa.storage.from("bpos-media").remove([`${a.businessId}/productos/foto1.webp`]);
  check("borra su foto", !rm.error && !bucket.map.has(`bpos-media/${a.businessId}/productos/foto1.webp`), rm.error);

  done();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
