/**
 * Tiempo real compatible con Supabase Realtime (protocolo Phoenix) para lo
 * que usa B-POS:
 *  - postgres_changes de sync_heads (aviso a las cajas de que hay cambios).
 *  - broadcast "agent-<id>" (tocarle la puerta al Agent cuando hay trabajo).
 *
 * Las cajas usan supabase-js (vsn 2.0.0: mensajes como arreglo) y el Agent
 * su propio cliente (vsn 1.0.0: mensajes como objeto). El Hub no sabe de
 * Cloudflare; el Durable Object (NubeRealtime) le pasa los sockets.
 */
import { verifyJwt } from "./auth";
import type { Db } from "./db";

export type Join = { topic: string; joinRef: string | null; pg: { id: number; table: string; filter: string; businessId: string | null }[] };
export type SocketState = { vsn: "1.0.0" | "2.0.0"; joins: Join[] };
export type HubSocket = { send(text: string): void; state(): SocketState; save(state: SocketState): void };
type Msg = { join_ref: string | null; ref: string | null; topic: string; event: string; payload: Record<string, unknown> };

const SYNC_HEADS_COLUMNS = [
  { name: "business_id", type: "uuid" },
  { name: "seq", type: "int8" },
  { name: "updated_at", type: "timestamptz" },
];

/**
 * supabase-js (realtime-js 2.x con vsn 2.0.0) manda los broadcast de un
 * cliente a otro en binario ("user broadcast push", tipo 3):
 *   [3, largo join_ref, largo ref, largo topic, largo evento, largo metadata, codificación]
 *   + join_ref + ref + topic + evento + metadata + contenido (1 = JSON, 0 = bytes)
 * Se convierte al mismo mensaje que llegaría en JSON. Otro tipo: se ignora.
 */
export function decodeBinaryBroadcast(data: ArrayBuffer | Uint8Array): Msg | null {
  try {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (bytes.length < 7 || bytes[0] !== 3) return null;
    const sizes = [bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]];
    const encoding = bytes[6];
    const text = new TextDecoder();
    let offset = 7;
    const [joinRef, ref, topic, event, metadata] = sizes.map((n) => {
      const part = text.decode(bytes.subarray(offset, offset + n));
      offset += n;
      return part;
    });
    if (offset > bytes.length || !topic || !event) return null;
    const body = bytes.subarray(offset);
    // Contenido en bytes (no lo usa B-POS): se manda como texto para no perderlo
    const payload = encoding === 1 ? (body.length ? JSON.parse(text.decode(body)) : {}) : { bytes: Array.from(body) };
    const meta = metadata ? (JSON.parse(metadata) as Record<string, unknown>) : {};
    return { join_ref: joinRef || null, ref: ref || null, topic, event: "broadcast", payload: { ...meta, type: "broadcast", event, payload } };
  } catch {
    return null;
  }
}

export class RealtimeHub {
  private nextId = 1;
  constructor(private deps: { db: Db; jwtSecret: string; serviceKey: string; sockets: () => HubSocket[] }) {}

  decode(text: string | ArrayBuffer | Uint8Array, vsn: SocketState["vsn"]): Msg | null {
    if (typeof text !== "string") return decodeBinaryBroadcast(text);
    try {
      const raw = JSON.parse(text);
      if (Array.isArray(raw)) return { join_ref: raw[0] ?? null, ref: raw[1] ?? null, topic: String(raw[2] ?? ""), event: String(raw[3] ?? ""), payload: (raw[4] ?? {}) as Record<string, unknown> };
      if (raw && typeof raw === "object") return { join_ref: raw.join_ref ?? null, ref: raw.ref ?? null, topic: String(raw.topic ?? ""), event: String(raw.event ?? ""), payload: (raw.payload ?? {}) as Record<string, unknown> };
    } catch {
      // mensaje roto: se ignora
    }
    void vsn;
    return null;
  }

  encode(m: Msg, vsn: SocketState["vsn"]) {
    return vsn === "1.0.0" ? JSON.stringify({ topic: m.topic, event: m.event, payload: m.payload, ref: m.ref, join_ref: m.join_ref }) : JSON.stringify([m.join_ref, m.ref, m.topic, m.event, m.payload]);
  }

  private reply(socket: HubSocket, m: Msg, status: "ok" | "error", response: Record<string, unknown>) {
    socket.send(this.encode({ join_ref: m.join_ref, ref: m.ref, topic: m.topic, event: "phx_reply", payload: { status, response } }, socket.state().vsn));
  }

  /** ¿Quien entra puede ver los cambios de ese negocio? (sync_heads: solo miembros) */
  private async canSee(token: unknown, businessId: string | null) {
    if (!businessId) return false;
    const t = String(token ?? "");
    if (t === this.deps.serviceKey) return true;
    const claims = await verifyJwt(t, this.deps.jwtSecret);
    if (!claims || typeof claims.sub !== "string") return false;
    return Boolean(await this.deps.db.first("SELECT 1 AS ok FROM business_members WHERE business_id = ? AND user_id = ?", [businessId, claims.sub]));
  }

  /** Diagnóstico temporal (28 nov): por qué no entra una caja al tiempo real */
  private async whyNot(token: unknown, businessId: string | null) {
    if (!businessId) return "sin negocio en el filtro";
    const t = String(token ?? "");
    if (!t) return "sin token";
    if (t.split(".").length !== 3) return "token no es JWT (" + t.slice(0, 12) + ")";
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    } catch {
      return "token ilegible";
    }
    const claims = await verifyJwt(t, this.deps.jwtSecret);
    if (!claims) return "firma o caducidad: iss=" + payload.iss + " exp=" + payload.exp + " ahora=" + Math.floor(Date.now() / 1000) + " sub=" + payload.sub;
    return "no es miembro: sub=" + claims.sub;
  }

  async onMessage(socket: HubSocket, text: string | ArrayBuffer | Uint8Array) {
    const st = socket.state();
    const m = this.decode(text, st.vsn);
    if (!m) return;
    if (m.topic === "phoenix" && m.event === "heartbeat") return this.reply(socket, m, "ok", {});
    if (m.event === "phx_join") {
      const config = (m.payload.config || {}) as { postgres_changes?: { event?: string; schema?: string; table?: string; filter?: string }[] };
      const pg: Join["pg"] = [];
      const response: { id: number; event: string; schema: string; table: string; filter?: string }[] = [];
      for (const f of config.postgres_changes || []) {
        const filter = f.filter || "";
        const businessId = /^business_id=eq\.([0-9a-f-]{36})$/i.exec(filter)?.[1] ?? null;
        if (f.table !== "sync_heads" || !(await this.canSee(m.payload.access_token, businessId))) {
          console.log("[rt] join rechazado", m.topic, f.table, await this.whyNot(m.payload.access_token, businessId));
          return this.reply(socket, m, "error", { reason: "Sin permiso para escuchar esos cambios" });
        }
        const id = this.nextId++ + Math.floor(Math.random() * 1e6) * 1000;
        pg.push({ id, table: f.table, filter, businessId });
        response.push({ id, event: f.event || "*", schema: f.schema || "public", table: f.table, ...(filter ? { filter } : {}) });
      }
      st.joins = st.joins.filter((j) => j.topic !== m.topic).concat({ topic: m.topic, joinRef: m.join_ref ?? m.ref, pg });
      socket.save(st);
      console.log("[rt] join ok", m.topic);
      return this.reply(socket, m, "ok", config.postgres_changes?.length ? { postgres_changes: response } : {});
    }
    if (m.event === "phx_leave") {
      st.joins = st.joins.filter((j) => j.topic !== m.topic);
      socket.save(st);
      return this.reply(socket, m, "ok", {});
    }
    if (m.event === "access_token") return;
    // broadcast que manda un cliente a otros (no se usa en B-POS, pero se respeta)
    if (m.event === "broadcast") {
      const payload = m.payload as { event?: string; payload?: unknown };
      this.broadcast([{ topic: m.topic.replace(/^realtime:/, ""), event: String(payload.event || ""), payload: payload.payload ?? {} }], socket);
      return;
    }
  }

  /** Cambió sync_records de un negocio: aviso a las cajas que escuchan sync_heads */
  notifySyncHead(businessId: string, seq: number) {
    const record = { business_id: businessId, seq: String(seq), updated_at: new Date().toISOString() };
    for (const s of this.deps.sockets()) {
      const st = s.state();
      for (const j of st.joins) {
        const ids = j.pg.filter((p) => p.table === "sync_heads" && p.businessId === businessId).map((p) => p.id);
        if (!ids.length) continue;
        s.send(
          this.encode(
            {
              join_ref: j.joinRef,
              ref: null,
              topic: j.topic,
              event: "postgres_changes",
              payload: { ids, data: { schema: "public", table: "sync_heads", commit_timestamp: record.updated_at, type: "UPDATE", columns: SYNC_HEADS_COLUMNS, record, old_record: { business_id: businessId }, errors: null } },
            },
            st.vsn
          )
        );
      }
    }
  }

  /** broadcast a un canal ("agent-<id>"): llega a quien entró a "realtime:agent-<id>" */
  broadcast(messages: { topic: string; event: string; payload: unknown }[], except?: HubSocket) {
    for (const s of this.deps.sockets()) {
      if (s === except) continue;
      const st = s.state();
      for (const msg of messages) {
        const topic = `realtime:${msg.topic}`;
        const j = st.joins.find((x) => x.topic === topic);
        if (!j) continue;
        s.send(this.encode({ join_ref: j.joinRef, ref: null, topic, event: "broadcast", payload: { type: "broadcast", event: msg.event, payload: msg.payload ?? {} } }, st.vsn));
      }
    }
  }
}
