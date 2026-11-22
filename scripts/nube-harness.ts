/**
 * Arma una nube de prueba: SQLite de Node con el esquema de D1 y clientes de
 * supabase-js que le hablan (los mismos que usa B-POS).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { nodeDb, type Db } from "../nube/db";
import { schemaSql } from "../nube/tables";
import { createUser } from "../nube/auth";
import { handleNubeRequest, type NubeDeps } from "../nube/router";

export const ANON = "nube-publica-prueba";
export const SERVICE = "nube-secreta-prueba";
export const BASE_URL = "http://nube.test/sb";

export type Harness = {
  db: Db;
  deps: NubeDeps;
  heads: { businessId: string; seq: number }[];
  broadcasts: { topic: string; event: string; payload: unknown }[];
  client: (opts?: { service?: boolean }) => SupabaseClient;
  signIn: (email: string, password: string) => Promise<SupabaseClient>;
};

export async function makeHarness(): Promise<Harness> {
  // node:sqlite (Node 22+): se carga por nombre porque los tipos de Node del proyecto aún no lo traen
  const sqliteModule = "node:sqlite";
  const { DatabaseSync } = (await import(sqliteModule)) as { DatabaseSync: new (path: string) => { exec(sql: string): void } };
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(schemaSql());
  const db = nodeDb(sqlite as never);
  const heads: Harness["heads"] = [];
  const broadcasts: Harness["broadcasts"] = [];
  const deps: NubeDeps = {
    db,
    base: "/sb",
    auth: { jwtSecret: "secreto-de-prueba-muy-largo-1234567890", serviceKey: SERVICE, anonKey: ANON, issuer: "http://nube.test/sb/auth/v1" },
    onSyncHead: (businessId, seq) => void heads.push({ businessId, seq }),
    broadcast: async (messages) => void broadcasts.push(...messages),
  };
  const fetcher = (input: RequestInfo | URL, init?: RequestInit) => handleNubeRequest(new Request(input as string, init), deps);
  const client = (opts: { service?: boolean } = {}) =>
    createClient(BASE_URL, opts.service ? SERVICE : ANON, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: fetcher as typeof fetch },
      realtime: { params: {} },
    });
  const signIn = async (email: string, password: string) => {
    const c = client();
    const { error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return c;
  };
  return { db, deps, heads, broadcasts, client, signIn };
}

/** Negocio con sucursal y su dueño (contraseña "secreta123") */
export async function seedBusiness(h: Harness, email: string, name = "Negocio prueba") {
  const created = await createUser(h.db, { email, password: "secreta123", confirmed: true });
  if (!created.user) throw new Error("no se creó el usuario");
  const uid = created.user.id;
  const businessId = crypto.randomUUID();
  const branchId = crypto.randomUUID();
  const now = new Date().toISOString();
  await h.db.batch([
    { sql: "INSERT INTO businesses (id, name, owner_id, created_at, trial_ends_at) VALUES (?, ?, ?, ?, ?)", params: [businessId, name, uid, now, now] },
    { sql: "INSERT INTO branches (id, business_id, name, created_at) VALUES (?, ?, ?, ?)", params: [branchId, businessId, "Centro", now] },
    { sql: "INSERT INTO business_members (business_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)", params: [businessId, uid, now] },
  ]);
  return { uid, businessId, branchId };
}

export function checker() {
  let ok = 0;
  let bad = 0;
  const check = (name: string, cond: boolean, extra?: unknown) => {
    if (cond) ok++;
    else bad++;
    console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
  };
  const done = () => {
    console.log(`\n${ok} bien, ${bad} mal`);
    if (bad) process.exit(1);
  };
  return { check, done };
}
