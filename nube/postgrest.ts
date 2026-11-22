/**
 * Lee las consultas que manda supabase-js (formato PostgREST) y las vuelve
 * SQL de SQLite:
 *   select=a,b,alias:c,businesses(name)
 *   status=eq.nuevo   id=in.(1,2)   deleted=is.false   data->>phone=like.*871*
 *   or=(a.eq.1,and(b.gt.2,c.is.null))   not.in.(…)
 *   order=received_at.desc.nullslast   limit=50   offset=0
 * Solo acepta columnas que existen (nada de SQL suelto desde afuera).
 */
import type { Table } from "./tables";
import { filterValue } from "./values";

export class RestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: string | null = null,
    public hint: string | null = null
  ) {
    super(message);
  }
}

// ------------------------------------------------------------ select

export type SelectNode = { kind: "col"; name: string; alias: string; path: string[]; text: boolean } | { kind: "star" } | { kind: "embed"; rel: string; alias: string; inner: boolean; nodes: SelectNode[] };

/** Parte por comas que no están dentro de paréntesis ni de comillas */
export function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' && s[i - 1] !== "\\") quoted = !quoted;
    if (!quoted) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        out.push(cur);
        cur = "";
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim() !== "") out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** "data->customer->>phone" → { name: "data", path: ["customer","phone"], text: true } */
export function parseColumn(raw: string) {
  const m = raw.split(/(->>?)/);
  const name = m[0].trim();
  const path: string[] = [];
  let text = false;
  for (let i = 1; i < m.length; i += 2) {
    text = m[i] === "->>";
    path.push(m[i + 1].trim().replace(/^'|'$/g, ""));
  }
  return { name, path, text };
}

export function parseSelect(select: string | null): SelectNode[] {
  const s = (select || "*").trim();
  if (s === "" || s === "*") return [{ kind: "star" }];
  return splitTop(s).map((item): SelectNode => {
    if (item === "*") return { kind: "star" };
    const paren = item.indexOf("(");
    if (paren > 0 && item.endsWith(")")) {
      let head = item.slice(0, paren).trim();
      const inside = item.slice(paren + 1, -1);
      let alias = "";
      if (head.includes(":")) [alias, head] = head.split(":").map((x) => x.trim());
      let inner = false;
      if (head.includes("!")) {
        const [rel, hint] = head.split("!");
        head = rel;
        inner = hint === "inner";
      }
      return { kind: "embed", rel: head, alias: alias || head, inner, nodes: parseSelect(inside) };
    }
    let alias = "";
    let colText = item;
    // "alias:col" (pero no confundir con "::tipo")
    const colon = item.search(/:(?!:)/);
    if (colon > 0) {
      alias = item.slice(0, colon).trim();
      colText = item.slice(colon + 1).trim();
    }
    colText = colText.replace(/::[a-z0-9_]+$/i, "");
    const col = parseColumn(colText);
    return { kind: "col", name: col.name, alias: alias || (col.path.length ? col.path[col.path.length - 1] : col.name), path: col.path, text: col.text };
  });
}

// ------------------------------------------------------------ filtros

export type Cond = { kind: "cond"; column: string; path: string[]; text: boolean; op: string; value: string; not: boolean } | { kind: "group"; op: "and" | "or"; not: boolean; items: Cond[] };

const OPS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is", "cs", "cd", "match", "imatch"]);
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

const unquote = (s: string) => (s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/\\"/g, '"') : s);

/** "eq.nuevo" o "not.in.(a,b)" para una columna */
function parseOpValue(column: string, raw: string): Cond {
  let rest = raw;
  let not = false;
  if (rest.startsWith("not.")) {
    not = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf(".");
  const op = dot >= 0 ? rest.slice(0, dot) : rest;
  if (!OPS.has(op)) throw new RestError(400, "PGRST100", `"failed to parse filter (${raw})" (line 1, column 1)`);
  const col = parseColumn(column);
  return { kind: "cond", column: col.name, path: col.path, text: col.text, op, value: dot >= 0 ? rest.slice(dot + 1) : "", not };
}

/** Lista "(a.eq.1,and(b.gt.2))" de or=/and= */
function parseLogic(op: "and" | "or", body: string, not: boolean): Cond {
  const inner = body.trim().replace(/^\(/, "").replace(/\)$/, "");
  const items = splitTop(inner).map((item): Cond => {
    let s = item;
    let n = false;
    if (s.startsWith("not.")) {
      n = true;
      s = s.slice(4);
    }
    const g = /^(and|or)\(([\s\S]*)\)$/.exec(s);
    if (g) return parseLogic(g[1] as "and" | "or", `(${g[2]})`, n);
    // "col.op.value" (la columna puede llevar -> pero no puntos)
    const m = /^([^.]+?)\.([\s\S]*)$/.exec(s);
    if (!m) throw new RestError(400, "PGRST100", `"failed to parse logic tree (${item})"`);
    return parseOpValue(m[1], (n ? "not." : "") + m[2]);
  });
  return { kind: "group", op, not, items };
}

export function parseFilters(params: URLSearchParams): Cond[] {
  const out: Cond[] = [];
  for (const [key, value] of params) {
    if (RESERVED.has(key)) continue;
    if (key === "or" || key === "and") out.push(parseLogic(key, value, false));
    else if (key === "not.or" || key === "not.and") out.push(parseLogic(key.slice(4) as "and" | "or", value, true));
    else if (key.includes(".") && !key.includes("->")) continue; // filtros de tablas embebidas: no se usan en B-POS
    else out.push(parseOpValue(key, value));
  }
  return out;
}

/** SQL de una columna (o de un dato dentro del JSON) ya revisada */
function columnSql(table: Table, name: string, path: string[], text: boolean) {
  const col = table.columns.find((c) => c.name === name);
  if (!col) throw new RestError(400, "42703", `column ${table.name}.${name} does not exist`);
  if (!path.length) return { sql: name, col, json: false };
  for (const key of path) if (!/^[A-Za-z0-9_]+$/.test(key)) throw new RestError(400, "PGRST100", `invalid json path ${key}`);
  const jp = `'$.${path.join(".")}'`;
  return { sql: text ? `CAST(json_extract(${name}, ${jp}) AS TEXT)` : `json_extract(${name}, ${jp})`, typeSql: `json_type(${name}, ${jp})`, col, json: true };
}

function parseList(raw: string): string[] {
  const inner = raw.trim().replace(/^\(/, "").replace(/\)$/, "");
  if (inner.trim() === "") return [];
  return splitTop(inner).map(unquote);
}

/** LIKE de PostgREST (* o %, sensible a mayúsculas) → GLOB de SQLite */
function likeToGlob(pattern: string) {
  return pattern.replace(/[[\]]/g, (m) => `[${m}]`).replace(/[*%]/g, "*").replace(/_/g, "?");
}

export function condSql(table: Table, cond: Cond, params: unknown[]): string {
  if (cond.kind === "group") {
    const parts = cond.items.map((c) => condSql(table, c, params));
    const sql = parts.length ? `(${parts.join(cond.op === "and" ? " AND " : " OR ")})` : cond.op === "and" ? "(1 = 1)" : "(1 = 0)";
    return cond.not ? `(NOT ${sql})` : sql;
  }
  const c = columnSql(table, cond.column, cond.path, cond.text);
  const value = unquote(cond.value);
  const conv = (raw: string) => (c.json ? raw : filterValue(c.col.type, raw));
  let sql: string;
  switch (cond.op) {
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const sym = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[cond.op];
      // Un número dentro del JSON (->) se compara como número
      const v = c.json && !cond.text && value !== "" && Number.isFinite(Number(value)) ? Number(value) : conv(value);
      params.push(v);
      sql = `${c.sql} ${sym} ?`;
      break;
    }
    case "like":
      params.push(likeToGlob(value));
      sql = `${c.sql} GLOB ?`;
      break;
    case "ilike":
      params.push(value.replace(/\*/g, "%").toLowerCase());
      sql = `lower(${c.sql}) LIKE ?`;
      break;
    case "in": {
      const list = parseList(cond.value);
      if (!list.length) sql = "1 = 0";
      else {
        list.forEach((x) => params.push(conv(x)));
        sql = `${c.sql} IN (${list.map(() => "?").join(", ")})`;
      }
      break;
    }
    case "is": {
      const v = value.toLowerCase();
      const target = c.json && !cond.text ? c.typeSql! : c.sql;
      if (v === "null") sql = `${target} IS NULL`;
      else if (v === "not_null") sql = `${target} IS NOT NULL`;
      else if (v === "true") sql = c.json ? `${c.typeSql} = 'true'` : `${c.sql} = 1`;
      else if (v === "false") sql = c.json ? `${c.typeSql} = 'false'` : `${c.sql} = 0`;
      else if (v === "unknown") sql = `${c.sql} IS NULL`;
      else throw new RestError(400, "PGRST100", `invalid is value ${value}`);
      break;
    }
    default:
      throw new RestError(400, "PGRST100", `filter ${cond.op} not supported`);
  }
  return cond.not ? `(NOT (${sql}))` : sql;
}

// ------------------------------------------------------------ orden

export function orderSql(table: Table, order: string | null): string {
  if (!order) return "";
  const parts = splitTop(order).map((item) => {
    const bits = item.split(".");
    // la columna puede traer -> (sin puntos); lo demás son asc/desc/nulls
    const flags = bits.slice(1);
    const colRaw = bits[0];
    const col = parseColumn(colRaw);
    const c = columnSql(table, col.name, col.path, col.text);
    const desc = flags.includes("desc");
    // Postgres: ASC con nulos al final, DESC con nulos al principio (salvo que se pida)
    const nullsFirst = flags.includes("nullsfirst") ? true : flags.includes("nullslast") ? false : desc;
    return `(${c.sql} IS NULL) ${nullsFirst ? "DESC" : "ASC"}, ${c.sql} ${desc ? "DESC" : "ASC"}`;
  });
  return parts.length ? ` ORDER BY ${parts.join(", ")}` : "";
}
