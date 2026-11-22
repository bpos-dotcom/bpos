/**
 * Mudanza de datos: copia de Supabase a la nube de Cloudflare.
 *
 * Se hace por pedazos (una página de una tabla por llamada) para no pasar los
 * límites de un Worker. Los números (seq, id) se copian tal cual: así cada
 * caja sigue bajando cambios desde donde iba. Se puede repetir sin
 * problema (INSERT OR REPLACE).
 *
 *  - Tablas: GET /rest/v1/<tabla> con la llave del servidor de Supabase.
 *  - Usuarios (con su contraseña cifrada): función nube_export_usuarios de
 *    Supabase (migración 0046), solo para la llave del servidor.
 *  - Fotos: se listan en Storage y se copian a R2.
 *  - Direcciones de fotos: las de Supabase se cambian por las de la nube.
 */
import { MAX_PARAMS, type Db, type Stmt } from "./db";
import { TABLES, TABLE, type Table } from "./tables";
import { normalizeTs, toDb } from "./values";
import type { BucketLike } from "./storage";
import { stashBlob } from "./rest";

export type Source = { url: string; key: string; fetch?: typeof fetch };

const headers = (s: Source) => ({ apikey: s.key, authorization: `Bearer ${s.key}` });
const get = (s: Source) => s.fetch || fetch;

/** Orden de copia (primero lo que otras tablas necesitan) */
export const COPY_ORDER = ["businesses", "branches", "business_members", "platform_admins", ...TABLES.map((t) => t.name).filter((n) => !["businesses", "branches", "business_members", "platform_admins"].includes(n))];

function insertSql(table: Table, cols: string[]) {
  return `INSERT OR REPLACE INTO ${table.name} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
}

/** Copia una página de una tabla. Regresa cuántas copió y si ya terminó */
export async function copyTablePage(db: Db, source: Source, tableName: string, offset: number, pageSize = 500, blobs?: BucketLike) {
  const table = TABLE.get(tableName);
  if (!table) throw new Error(`Tabla desconocida: ${tableName}`);
  const order = table.pk.map((k) => `${k}.asc`).join(",");
  const res = await get(source)(`${source.url}/rest/v1/${table.name}?select=*&order=${order}&limit=${pageSize}&offset=${offset}`, { headers: headers(source) });
  if (!res.ok) throw new Error(`Supabase respondió ${res.status} en ${table.name}: ${(await res.text()).slice(0, 200)}`);
  const rows = await Promise.all(((await res.json()) as Record<string, unknown>[]).map((r) => stashBlob(table.name, r, blobs)));
  const cols = table.columns.map((c) => c.name);
  const statements: Stmt[] = rows.map((r) => ({ sql: insertSql(table, cols), params: table.columns.map((c) => toDb(c.type, r[c.name] ?? null)) }));
  // De a poco: D1 aguanta transacciones medianas
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
  return { copied: rows.length, done: rows.length < pageSize, next: offset + rows.length };
}

/** El número de cambios (sync_seq) sigue después del más alto copiado */
export async function fixSequences(db: Db) {
  const r = await db.first<{ m: number }>("SELECT COALESCE(MAX(seq), 0) AS m FROM sync_records");
  const max = Number(r?.m || 0);
  await db.run("INSERT INTO nube_sequences (name, value) VALUES ('sync_seq', ?) ON CONFLICT (name) DO UPDATE SET value = max(value, excluded.value)", [max]);
  // sync_heads al día con lo copiado
  await db.run("INSERT INTO sync_heads (business_id, seq, updated_at) SELECT business_id, MAX(seq), ? FROM sync_records GROUP BY business_id ON CONFLICT (business_id) DO UPDATE SET seq = max(sync_heads.seq, excluded.seq)", [new Date().toISOString()]);
  return max;
}

type ExportedUser = {
  id: string;
  email: string;
  encrypted_password: string | null;
  email_confirmed_at: string | null;
  raw_user_meta_data: unknown;
  raw_app_meta_data: unknown;
  banned_until: string | null;
  last_sign_in_at: string | null;
  created_at: string;
  updated_at: string | null;
};

/** Copia una página de usuarios (con su contraseña cifrada, para que entren igual) */
export async function copyUsersPage(db: Db, source: Source, offset: number, pageSize = 500) {
  const res = await get(source)(`${source.url}/rest/v1/rpc/nube_export_usuarios`, {
    method: "POST",
    headers: { ...headers(source), "content-type": "application/json" },
    body: JSON.stringify({ p_offset: offset, p_limit: pageSize }),
  });
  if (!res.ok) throw new Error(`Supabase respondió ${res.status} en usuarios: ${(await res.text()).slice(0, 200)}`);
  const users = (await res.json()) as ExportedUser[];
  const statements: Stmt[] = users
    .filter((u) => u.email)
    .map((u) => {
      const app = { ...((u.raw_app_meta_data as Record<string, unknown>) || {}) };
      delete app.provider;
      delete app.providers;
      return {
        sql: "INSERT OR REPLACE INTO nube_users (id, email, encrypted_password, email_confirmed_at, user_metadata, app_metadata, banned_until, last_sign_in_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params: [
          u.id,
          u.email.toLowerCase(),
          u.encrypted_password || "",
          normalizeTs(u.email_confirmed_at),
          JSON.stringify(u.raw_user_meta_data || {}),
          JSON.stringify(app),
          normalizeTs(u.banned_until),
          normalizeTs(u.last_sign_in_at),
          normalizeTs(u.created_at) || new Date().toISOString(),
          normalizeTs(u.updated_at || u.created_at) || new Date().toISOString(),
        ],
      };
    });
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
  return { copied: users.length, done: users.length < pageSize, next: offset + users.length };
}

type ListItem = { name: string; id: string | null; metadata?: { mimetype?: string; cacheControl?: string } | null };

/** Copia las fotos de una carpeta de Storage a R2 (y regresa las subcarpetas para seguir) */
export async function copyFilesFolder(source: Source, bucket: BucketLike, bucketName: string, prefix: string) {
  const res = await get(source)(`${source.url}/storage/v1/object/list/${bucketName}`, {
    method: "POST",
    headers: { ...headers(source), "content-type": "application/json" },
    body: JSON.stringify({ prefix, limit: 1000, offset: 0, sortBy: { column: "name", order: "asc" } }),
  });
  if (!res.ok) throw new Error(`Storage respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const items = (await res.json()) as ListItem[];
  const folders: string[] = [];
  let copied = 0;
  for (const item of items) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (!item.id) {
      folders.push(path);
      continue;
    }
    const key = `${bucketName}/${path}`;
    if (await bucket.head(key)) continue; // ya estaba copiada
    const file = await get(source)(`${source.url}/storage/v1/object/public/${bucketName}/${path.split("/").map(encodeURIComponent).join("/")}`);
    if (!file.ok) continue;
    await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: item.metadata?.mimetype || file.headers.get("content-type") || "application/octet-stream", cacheControl: item.metadata?.cacheControl || "31536000" } });
    copied++;
  }
  return { copied, folders };
}

/**
 * Cambia las direcciones de fotos de Supabase por las de la nube en los datos
 * y les da número nuevo a esos cambios para que todas las cajas los bajen.
 */
export async function rewriteFileUrls(db: Db, oldBase: string, newBase: string) {
  const like = `%${oldBase}%`;
  const ids = await db.all<{ business_id: string; scope: string; collection: string; record_id: string }>("SELECT business_id, scope, collection, record_id FROM sync_records WHERE data LIKE ?", [like]);
  const seq0 = await fixSequences(db);
  const statements: Stmt[] = ids.map((r, i) => ({
    sql: "UPDATE sync_records SET data = replace(data, ?, ?), seq = ?, updated_at = ? WHERE business_id = ? AND scope = ? AND collection = ? AND record_id = ?",
    params: [oldBase, newBase, seq0 + i + 1, new Date().toISOString(), r.business_id, r.scope, r.collection, r.record_id],
  }));
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
  await db.batch([
    { sql: "UPDATE bpos_task_evidence SET photo_url = replace(photo_url, ?, ?), items = replace(items, ?, ?) WHERE photo_url LIKE ? OR items LIKE ?", params: [oldBase, newBase, oldBase, newBase, like, like] },
    { sql: "UPDATE bpos_backups SET data = replace(data, ?, ?) WHERE data LIKE ?", params: [oldBase, newBase, like] },
  ]);
  await fixSequences(db);
  return { records: ids.length };
}

/** Cuántas filas hay en cada tabla (para comparar contra Supabase al terminar) */
export async function counts(db: Db) {
  const out: Record<string, number> = {};
  for (const name of [...COPY_ORDER, "nube_users"]) {
    const r = await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${name}`);
    out[name] = Number(r?.n || 0);
  }
  return out;
}

export { MAX_PARAMS };
