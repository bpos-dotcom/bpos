/**
 * /rest/v1/<tabla> compatible con PostgREST (lo que usa supabase-js):
 * GET (con conteo y embebidos), POST (insertar y upsert), PATCH y DELETE,
 * con las reglas de acceso (access.ts) y los triggers (triggers.ts).
 */
import { MAX_PARAMS, chunk, type Db, type Row, type Stmt } from "./db";
import { AccessCtx, allowed, type Auth, type Cmd } from "./access";
import { RELATIONS, TABLE, type Column, type Table } from "./tables";
import { RestError, condSql, orderSql, parseFilters, parseSelect, type SelectNode } from "./postgrest";
import { beforeDelete, beforeInsert, beforeUpdate, type TriggerCtx } from "./triggers";
import { fromDb, nowIso, rowFromDb, toDb } from "./values";
import type { BucketLike } from "./storage";

/**
 * Columnas muy grandes que no caben en D1 (máximo 2 MB por fila): el
 * contenido va a R2 y en la tabla queda una marca {"$blob": "<llave>"}.
 * Los respaldos diarios pesan hasta 10 MB.
 */
export const BLOB_COLUMNS: Record<string, { col: string; key: (row: Row) => string }> = {
  bpos_backups: { col: "data", key: (row) => `blobs/bpos_backups/${row.business_id}/${String(row.day).slice(0, 10)}.json` },
};
const BLOB_PREFIX = '{"$blob":';

/** Antes de guardar: el valor grande se sube a R2 y la fila lleva la marca */
export async function stashBlob(table: string, row: Row, blobs: BucketLike | undefined) {
  const spec = BLOB_COLUMNS[table];
  if (!spec || !blobs) return row;
  const value = row[spec.col];
  if (value === null || value === undefined) return row;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.startsWith(BLOB_PREFIX)) return row;
  const key = spec.key(row);
  await blobs.put(key, new TextEncoder().encode(text), { httpMetadata: { contentType: "application/json" } });
  return { ...row, [spec.col]: { $blob: key } };
}

/** Al leer: la marca se cambia por el contenido de R2 (texto JSON como lo guarda D1) */
async function unstashBlobs(table: string, rows: Row[], blobs: BucketLike | undefined) {
  const spec = BLOB_COLUMNS[table];
  if (!spec || !blobs) return rows;
  return Promise.all(
    rows.map(async (r) => {
      const raw = r[spec.col];
      if (typeof raw !== "string" || !raw.startsWith(BLOB_PREFIX)) return r;
      const key = (JSON.parse(raw) as { $blob: string }).$blob;
      const obj = await blobs.get(key);
      return { ...r, [spec.col]: obj ? new TextDecoder().decode(await obj.arrayBuffer()) : null };
    })
  );
}

export type NubeCtx = {
  db: Db;
  auth: Auth;
  /** Se cambió sync_records de un negocio: su último número (para avisar en tiempo real) */
  onSyncHead?: (businessId: string, seq: number) => void | Promise<void>;
  /** R2 para las columnas grandes (BLOB_COLUMNS) */
  blobs?: BucketLike;
};

export type RestRequest = { method: string; table: string; params: URLSearchParams; headers: Headers; body: unknown };
export type Reply = { status: number; headers: Record<string, string>; body: string | null };

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export function errorReply(e: unknown): Reply {
  if (e instanceof RestError) return { status: e.status, headers: JSON_HEADERS, body: JSON.stringify({ code: e.code, message: e.message, details: e.details, hint: e.hint }) };
  const message = e instanceof Error ? e.message : String(e);
  // Errores de SQLite → los códigos de Postgres que espera B-POS
  if (/UNIQUE constraint failed/i.test(message)) return { status: 409, headers: JSON_HEADERS, body: JSON.stringify({ code: "23505", message: `duplicate key value violates unique constraint (${message})`, details: null, hint: null }) };
  if (/CHECK constraint failed/i.test(message)) return { status: 400, headers: JSON_HEADERS, body: JSON.stringify({ code: "23514", message: `new row violates check constraint (${message})`, details: null, hint: null }) };
  if (/NOT NULL constraint failed/i.test(message)) return { status: 400, headers: JSON_HEADERS, body: JSON.stringify({ code: "23502", message: `null value violates not-null constraint (${message})`, details: null, hint: null }) };
  return { status: 500, headers: JSON_HEADERS, body: JSON.stringify({ code: "XX000", message, details: null, hint: null }) };
}

function tableOf(name: string): Table {
  const table = TABLE.get(name);
  if (!table) throw new RestError(404, "42P01", `relation "public.${name}" does not exist`);
  return table;
}

function deny(table: string, cmd: Cmd, auth: Auth): never {
  if (cmd === "select") throw new RestError(auth.role === "anon" ? 401 : 403, "42501", `permission denied for table ${table}`);
  throw new RestError(auth.role === "anon" ? 401 : 403, "42501", `new row violates row-level security policy for table "${table}"`);
}

const prefer = (headers: Headers) => {
  const p = (headers.get("prefer") || "").toLowerCase();
  return {
    representation: p.includes("return=representation"),
    count: /count=(exact|planned|estimated)/.test(p),
    merge: p.includes("resolution=merge-duplicates"),
    ignore: p.includes("resolution=ignore-duplicates"),
  };
};
const wantsObject = (headers: Headers) => (headers.get("accept") || "").includes("application/vnd.pgrst.object+json");

/** WHERE con los filtros de la dirección y la regla de acceso */
function whereSql(table: Table, params: URLSearchParams, using: { sql: string; params: unknown[] } | null) {
  const values: unknown[] = [];
  const parts = parseFilters(params).map((cond) => condSql(table, cond, values));
  if (using) {
    parts.push(`(${using.sql})`);
    values.push(...using.params);
  }
  return { sql: parts.length ? ` WHERE ${parts.join(" AND ")}` : "", params: values };
}

// ------------------------------------------------------------ proyección (select) y embebidos

function project(table: Table, nodes: SelectNode[], row: Row, embeds: Map<string, Map<unknown, Row | null>>): Row {
  const out: Row = {};
  for (const node of nodes) {
    if (node.kind === "star") Object.assign(out, rowFromDb(table.columns, row));
    else if (node.kind === "col") {
      const col = table.columns.find((c) => c.name === node.name);
      if (!col) throw new RestError(400, "42703", `column ${table.name}.${node.name} does not exist`);
      let value = fromDb(col.type, row[col.name]);
      for (const key of node.path) value = value && typeof value === "object" ? (value as Row)[key] : null;
      if (node.text && value !== null && value !== undefined && typeof value !== "string") value = typeof value === "object" ? JSON.stringify(value) : String(value);
      out[node.alias] = value ?? null;
    } else {
      const rel = RELATIONS[table.name]?.[node.rel];
      if (!rel) throw new RestError(400, "PGRST200", `Could not find a relationship between '${table.name}' and '${node.rel}'`);
      out[node.alias] = embeds.get(node.alias)?.get(row[rel[0]]) ?? null;
    }
  }
  return out;
}

async function loadEmbeds(ctx: NubeCtx, table: Table, nodes: SelectNode[], rows: Row[]) {
  const embeds = new Map<string, Map<unknown, Row | null>>();
  for (const node of nodes) {
    if (node.kind !== "embed") continue;
    const rel = RELATIONS[table.name]?.[node.rel];
    if (!rel) throw new RestError(400, "PGRST200", `Could not find a relationship between '${table.name}' and '${node.rel}'`);
    const other = tableOf(node.rel);
    const access = allowed(other.name, "select", ctx.auth);
    const map = new Map<unknown, Row | null>();
    embeds.set(node.alias, map);
    if (!access.ok) continue;
    const keys = [...new Set(rows.map((r) => r[rel[0]]).filter((k) => k !== null && k !== undefined))];
    for (const part of chunk(keys, MAX_PARAMS - 10)) {
      const params: unknown[] = [...part];
      let sql = `SELECT * FROM ${other.name} WHERE ${rel[1]} IN (${part.map(() => "?").join(", ")})`;
      if (access.using) {
        sql += ` AND (${access.using.sql})`;
        params.push(...access.using.params);
      }
      for (const r of await ctx.db.all(sql, params)) map.set(r[rel[1]], project(other, node.nodes, r, new Map()));
    }
  }
  return embeds;
}

async function shape(ctx: NubeCtx, table: Table, select: string | null, rawRows: Row[]) {
  const nodes = parseSelect(select);
  const spec = BLOB_COLUMNS[table.name];
  // Solo se baja de R2 si se pidió esa columna
  const wantsBlob = spec && nodes.some((n) => n.kind === "star" || (n.kind === "col" && n.name === spec.col));
  const rows = wantsBlob ? await unstashBlobs(table.name, rawRows, ctx.blobs) : rawRows;
  const embeds = await loadEmbeds(ctx, table, nodes, rows);
  let out = rows.map((r) => project(table, nodes, r, embeds));
  // "!inner": solo las filas que sí tienen su relación
  for (const node of nodes) if (node.kind === "embed" && node.inner) out = out.filter((r) => r[node.alias] !== null);
  return out;
}

function reply(rows: Row[], headers: Headers, extra: Record<string, string> = {}, status = 200): Reply {
  if (wantsObject(headers)) {
    if (rows.length !== 1) throw new RestError(406, "PGRST116", "JSON object requested, multiple (or no) rows returned", `The result contains ${rows.length} rows`);
    return { status, headers: { ...JSON_HEADERS, ...extra }, body: JSON.stringify(rows[0]) };
  }
  return { status, headers: { ...JSON_HEADERS, ...extra }, body: JSON.stringify(rows) };
}

// ------------------------------------------------------------ GET

async function get(ctx: NubeCtx, req: RestRequest, head: boolean): Promise<Reply> {
  const table = tableOf(req.table);
  const access = allowed(table.name, "select", ctx.auth);
  if (!access.ok) deny(table.name, "select", ctx.auth);
  const where = whereSql(table, req.params, access.using);
  const limit = req.params.get("limit");
  const offset = Number(req.params.get("offset") || 0) || 0;
  let sql = `SELECT * FROM ${table.name}${where.sql}${orderSql(table, req.params.get("order"))}`;
  const params = [...where.params];
  if (limit !== null) {
    sql += " LIMIT ? OFFSET ?";
    params.push(Math.max(0, Number(limit) || 0), offset);
  } else if (offset) {
    sql += " LIMIT -1 OFFSET ?";
    params.push(offset);
  }
  const p = prefer(req.headers);
  const extra: Record<string, string> = {};
  let total: number | null = null;
  if (p.count) {
    const r = await ctx.db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table.name}${where.sql}`, where.params);
    total = Number(r?.n || 0);
  }
  if (head) {
    extra["content-range"] = `*/${total ?? "*"}`;
    return { status: 200, headers: { ...JSON_HEADERS, ...extra }, body: null };
  }
  const rows = await ctx.db.all(sql, params);
  const shaped = await shape(ctx, table, req.params.get("select"), rows);
  extra["content-range"] = `${shaped.length ? `${offset}-${offset + shaped.length - 1}` : "*"}/${total ?? "*"}`;
  return reply(shaped, req.headers, extra);
}

// ------------------------------------------------------------ escrituras

function triggerCtx(ctx: NubeCtx, access: AccessCtx): TriggerCtx {
  return {
    auth: ctx.auth,
    isAdmin: () => access.isAdmin(),
    nextSeq: async (name) => {
      const r = await ctx.db.first<{ value: number }>("INSERT INTO nube_sequences (name, value) VALUES (?, 1) ON CONFLICT (name) DO UPDATE SET value = value + 1 RETURNING value", [name]);
      return Number(r?.value);
    },
  };
}

/** Fila que llega (JSON) → fila completa con valores de B-POS (data como objeto), con lo que falte por defecto */
function withDefaults(table: Table, input: Row, auth: Auth): Row {
  for (const key of Object.keys(input)) {
    if (!table.columns.some((c) => c.name === key)) throw new RestError(400, "PGRST204", `Could not find the '${key}' column of '${table.name}' in the schema cache`);
  }
  const row: Row = {};
  for (const col of table.columns) {
    if (col.name in input && input[col.name] !== undefined) {
      row[col.name] = input[col.name];
      continue;
    }
    const d = col.default;
    if (!d) row[col.name] = null;
    else if (d.kind === "uuid") row[col.name] = crypto.randomUUID();
    else if (d.kind === "now") row[col.name] = nowIso();
    else if (d.kind === "uid") row[col.name] = auth.uid;
    else if (d.kind === "nowPlusDays") row[col.name] = new Date(Date.now() + d.days * 86400000).toISOString();
    else if (d.kind === "value") row[col.name] = d.value;
    // identity y seq: los pone SQLite o el trigger
  }
  return row;
}

/** Fila de D1 → fila con valores de B-POS (para triggers y reglas) */
const decode = (table: Table, row: Row) => rowFromDb(table.columns, row);

function encodeCols(table: Table, row: Row, cols: Column[]) {
  return cols.map((c) => toDb(c.type, row[c.name]));
}

function insertStmt(table: Table, row: Row, conflict: string[] | null, mode: "merge" | "ignore" | "error", updateCols: string[]): Stmt {
  const cols = table.columns.filter((c) => !(c.default?.kind === "identity" && (row[c.name] === null || row[c.name] === undefined)) && (c.default?.kind !== "seq" || row[c.name] !== undefined));
  let sql = `INSERT INTO ${table.name} (${cols.map((c) => c.name).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
  if (conflict && mode === "ignore") sql += ` ON CONFLICT (${conflict.join(", ")}) DO NOTHING`;
  else if (conflict && mode === "merge") {
    const set = updateCols.filter((c) => !conflict.includes(c));
    sql += set.length ? ` ON CONFLICT (${conflict.join(", ")}) DO UPDATE SET ${set.map((c) => `${c} = excluded.${c}`).join(", ")}` : ` ON CONFLICT (${conflict.join(", ")}) DO NOTHING`;
  }
  return { sql: `${sql} RETURNING *`, params: encodeCols(table, row, cols) };
}

function updateStmt(table: Table, row: Row, pk: Row): Stmt {
  const cols = table.columns.filter((c) => !table.pk.includes(c.name) || c.default?.kind !== "identity");
  return {
    sql: `UPDATE ${table.name} SET ${cols.map((c) => `${c.name} = ?`).join(", ")} WHERE ${table.pk.map((k) => `${k} = ?`).join(" AND ")} RETURNING *`,
    params: [...encodeCols(table, row, cols), ...table.pk.map((k) => toDb(table.columns.find((c) => c.name === k)!.type, pk[k]))],
  };
}

/** Filas actuales con esas llaves (para upsert): llave → fila */
async function existingByKeys(ctx: NubeCtx, table: Table, keys: string[], rows: Row[]) {
  const found = new Map<string, Row>();
  const keyOf = (r: Row) => JSON.stringify(keys.map((k) => toDb(table.columns.find((c) => c.name === k)!.type, r[k])));
  const per = Math.max(1, Math.floor((MAX_PARAMS - 5) / keys.length));
  for (const part of chunk(rows, per)) {
    const params: unknown[] = [];
    const ors = part.map((r) => {
      keys.forEach((k) => params.push(toDb(table.columns.find((c) => c.name === k)!.type, r[k])));
      return `(${keys.map((k) => `${k} = ?`).join(" AND ")})`;
    });
    for (const r of await ctx.db.all(`SELECT * FROM ${table.name} WHERE ${ors.join(" OR ")}`, params)) found.set(keyOf(r), r);
  }
  return { found, keyOf };
}

async function bumpHeads(ctx: NubeCtx, table: Table, rows: Row[]) {
  if (table.name !== "sync_records" || !rows.length) return;
  const max = new Map<string, number>();
  for (const r of rows) {
    const b = String(r.business_id);
    max.set(b, Math.max(max.get(b) || 0, Number(r.seq) || 0));
  }
  const now = nowIso();
  await ctx.db.batch(
    [...max].map(([b, seq]) => ({
      sql: "INSERT INTO sync_heads (business_id, seq, updated_at) VALUES (?, ?, ?) ON CONFLICT (business_id) DO UPDATE SET seq = max(seq, excluded.seq), updated_at = excluded.updated_at",
      params: [b, seq, now],
    }))
  );
  for (const [b, seq] of max) await ctx.onSyncHead?.(b, seq);
}

/** ¿La fila actual se puede tocar (regla using)? */
async function visible(ctx: NubeCtx, table: Table, using: { sql: string; params: unknown[] } | null, row: Row) {
  if (!using) return true;
  const r = await ctx.db.first(`SELECT 1 AS ok FROM ${table.name} WHERE ${table.pk.map((k) => `${k} = ?`).join(" AND ")} AND (${using.sql})`, [...table.pk.map((k) => row[k]), ...using.params]);
  return Boolean(r);
}

async function post(ctx: NubeCtx, req: RestRequest): Promise<Reply> {
  const table = tableOf(req.table);
  const insertAccess = allowed(table.name, "insert", ctx.auth);
  if (!insertAccess.ok) deny(table.name, "insert", ctx.auth);
  const p = prefer(req.headers);
  const upsert = p.merge || p.ignore;
  const updateAccess = upsert && p.merge ? allowed(table.name, "update", ctx.auth) : null;
  if (updateAccess && !updateAccess.ok) deny(table.name, "update", ctx.auth);
  const inputs = (Array.isArray(req.body) ? req.body : [req.body]).filter((x): x is Row => Boolean(x) && typeof x === "object");
  if (!inputs.length) return reply([], req.headers, {}, 201);

  const access = new AccessCtx(ctx.db, ctx.auth);
  const tctx = triggerCtx(ctx, access);
  const conflict = upsert ? (req.params.get("on_conflict") || table.pk.join(",")).split(",").map((s) => s.trim()) : null;
  if (conflict) for (const k of conflict) if (!table.columns.some((c) => c.name === k)) throw new RestError(400, "42703", `column ${k} does not exist`);
  const existing = conflict ? await existingByKeys(ctx, table, conflict, inputs) : null;

  const statements: Stmt[] = [];
  for (const input of inputs) {
    const old = existing?.found.get(existing.keyOf(input));
    if (old) {
      if (p.ignore) continue;
      // Upsert de una fila que ya existe: es un cambio (con sus triggers y su regla)
      const oldRow = decode(table, old);
      if (updateAccess?.ok && updateAccess.using && !(await visible(ctx, table, updateAccess.using, old))) deny(table.name, "update", ctx.auth);
      const merged = { ...oldRow };
      for (const [k, value] of Object.entries(input)) {
        if (!table.columns.some((c) => c.name === k)) throw new RestError(400, "PGRST204", `Could not find the '${k}' column of '${table.name}' in the schema cache`);
        merged[k] = value;
      }
      const next = await stashBlob(table.name, await beforeUpdate(table.name, oldRow, merged, tctx), ctx.blobs);
      if (updateAccess?.ok && updateAccess.check && !(await updateAccess.check(next, access))) deny(table.name, "update", ctx.auth);
      statements.push(updateStmt(table, next, oldRow));
      continue;
    }
    const row = await stashBlob(table.name, await beforeInsert(table.name, withDefaults(table, input, ctx.auth), tctx), ctx.blobs);
    if (insertAccess.check && !(await insertAccess.check(row, access))) deny(table.name, "insert", ctx.auth);
    // Por si otro equipo la creó en este instante: no truena, se mezcla o se ignora
    statements.push(insertStmt(table, row, conflict, p.ignore ? "ignore" : conflict ? "merge" : "error", Object.keys(input).concat(table.name === "sync_records" ? ["seq", "updated_at"] : [])));
  }
  const results = await ctx.db.batch(statements);
  const written = results.flat();
  await bumpHeads(ctx, table, written.map((r) => decode(table, r)));
  if (!p.representation) return { status: 201, headers: {}, body: null };
  return reply(await shape(ctx, table, req.params.get("select"), written), req.headers, {}, 201);
}

async function patch(ctx: NubeCtx, req: RestRequest): Promise<Reply> {
  const table = tableOf(req.table);
  const access = allowed(table.name, "update", ctx.auth);
  if (!access.ok) deny(table.name, "update", ctx.auth);
  const changes = (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {}) as Row;
  for (const k of Object.keys(changes)) if (!table.columns.some((c) => c.name === k)) throw new RestError(400, "PGRST204", `Could not find the '${k}' column of '${table.name}' in the schema cache`);
  const where = whereSql(table, req.params, access.using);
  const rows = await ctx.db.all(`SELECT * FROM ${table.name}${where.sql}`, where.params);
  const actx = new AccessCtx(ctx.db, ctx.auth);
  const tctx = triggerCtx(ctx, actx);
  const statements: Stmt[] = [];
  for (const raw of rows) {
    const oldRow = decode(table, raw);
    const next = await stashBlob(table.name, await beforeUpdate(table.name, oldRow, { ...oldRow, ...changes }, tctx), ctx.blobs);
    if (access.check && !(await access.check(next, actx))) deny(table.name, "update", ctx.auth);
    statements.push(updateStmt(table, next, oldRow));
  }
  const written = (await ctx.db.batch(statements)).flat();
  await bumpHeads(ctx, table, written.map((r) => decode(table, r)));
  if (!prefer(req.headers).representation) return { status: 204, headers: {}, body: null };
  return reply(await shape(ctx, table, req.params.get("select"), written), req.headers);
}

async function del(ctx: NubeCtx, req: RestRequest): Promise<Reply> {
  const table = tableOf(req.table);
  const access = allowed(table.name, "delete", ctx.auth);
  if (!access.ok) deny(table.name, "delete", ctx.auth);
  const where = whereSql(table, req.params, access.using);
  const rows = await ctx.db.all(`SELECT * FROM ${table.name}${where.sql}`, where.params);
  const statements: Stmt[] = [];
  const gone: Row[] = [];
  for (const raw of rows) {
    if (!(await beforeDelete(table.name, decode(table, raw)))) continue;
    gone.push(raw);
    statements.push({ sql: `DELETE FROM ${table.name} WHERE ${table.pk.map((k) => `${k} = ?`).join(" AND ")}`, params: table.pk.map((k) => raw[k]) });
  }
  await ctx.db.batch(statements);
  // Lo que estaba en R2 también se borra
  const spec = BLOB_COLUMNS[table.name];
  if (spec && ctx.blobs) {
    const keys = gone.map((r) => r[spec.col]).filter((v): v is string => typeof v === "string" && v.startsWith(BLOB_PREFIX)).map((v) => (JSON.parse(v) as { $blob: string }).$blob);
    if (keys.length) await ctx.blobs.delete(keys).catch(() => undefined);
  }
  if (!prefer(req.headers).representation) return { status: 204, headers: {}, body: null };
  return reply(await shape(ctx, table, req.params.get("select"), gone), req.headers);
}

export async function handleRest(ctx: NubeCtx, req: RestRequest): Promise<Reply> {
  try {
    switch (req.method.toUpperCase()) {
      case "GET":
        return await get(ctx, req, false);
      case "HEAD":
        return await get(ctx, req, true);
      case "POST":
        return await post(ctx, req);
      case "PATCH":
        return await patch(ctx, req);
      case "DELETE":
        return await del(ctx, req);
      default:
        throw new RestError(405, "PGRST117", `Unsupported HTTP method: ${req.method}`);
    }
  } catch (e) {
    return errorReply(e);
  }
}
