/**
 * La base de datos de la nube: D1 en Cloudflare, o SQLite de Node en las
 * pruebas. Las dos se ven igual para el resto de la nube.
 *
 * D1 acepta hasta 100 valores por consulta: quien arma consultas grandes las
 * parte (ver `chunk`).
 */

export type Row = Record<string, unknown>;
export type Stmt = { sql: string; params?: unknown[] };

export interface Db {
  all<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  first<T = Row>(sql: string, params?: unknown[]): Promise<T | null>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number; lastId: number }>;
  /** Varias consultas juntas (en D1 van en una sola transacción) */
  batch(statements: Stmt[]): Promise<Row[][]>;
}

/** Máximo de valores por consulta en D1 */
export const MAX_PARAMS = 100;

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// ------------------------------------------------------------ D1 (Cloudflare)

type D1Result = { results?: Row[]; meta?: { changes?: number; last_row_id?: number } };
type D1Prepared = { bind(...values: unknown[]): D1Prepared; all(): Promise<D1Result>; first(): Promise<Row | null>; run(): Promise<D1Result> };
export type D1Like = { prepare(sql: string): D1Prepared; batch(statements: D1Prepared[]): Promise<D1Result[]> };

const clean = (params: unknown[] = []) => params.map((p) => (p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : p));

export function d1Db(d1: D1Like): Db {
  const prep = (sql: string, params?: unknown[]) => d1.prepare(sql).bind(...clean(params));
  return {
    async all<T>(sql: string, params?: unknown[]) {
      return ((await prep(sql, params).all()).results || []) as T[];
    },
    async first<T>(sql: string, params?: unknown[]) {
      return ((await prep(sql, params).first()) as T | null) ?? null;
    },
    async run(sql: string, params?: unknown[]) {
      const r = await prep(sql, params).run();
      return { changes: Number(r.meta?.changes || 0), lastId: Number(r.meta?.last_row_id || 0) };
    },
    async batch(statements: Stmt[]) {
      if (!statements.length) return [];
      const results = await d1.batch(statements.map((s) => prep(s.sql, s.params)));
      return results.map((r) => r.results || []);
    },
  };
}

// ------------------------------------------------------------ SQLite de Node (pruebas)

type NodeStatement = { all(...p: unknown[]): Row[]; get(...p: unknown[]): Row | undefined; run(...p: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint } };
export type NodeSqlite = { prepare(sql: string): NodeStatement; exec(sql: string): void };

export function nodeDb(db: NodeSqlite): Db {
  const fix = (row: Row | undefined) => {
    if (!row) return row;
    const out: Row = {};
    for (const [k, value] of Object.entries(row)) out[k] = typeof value === "bigint" ? Number(value) : value;
    return out;
  };
  const isRead = (sql: string) => /^\s*(select|with)\b/i.test(sql) || /\breturning\b/i.test(sql);
  const self: Db = {
    async all<T>(sql: string, params?: unknown[]) {
      return db.prepare(sql).all(...clean(params)).map((r) => fix(r)) as T[];
    },
    async first<T>(sql: string, params?: unknown[]) {
      return (fix(db.prepare(sql).get(...clean(params))) as T | undefined) ?? null;
    },
    async run(sql: string, params?: unknown[]) {
      const r = db.prepare(sql).run(...clean(params));
      return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
    },
    async batch(statements: Stmt[]) {
      db.exec("BEGIN");
      try {
        const out: Row[][] = [];
        for (const s of statements) out.push(isRead(s.sql) ? await self.all(s.sql, s.params) : (await self.run(s.sql, s.params), []));
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return self;
}
