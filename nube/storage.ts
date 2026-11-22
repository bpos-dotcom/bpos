/**
 * /storage/v1 compatible con Supabase Storage, guardando en R2:
 *   POST|PUT /object/<bucket>/<ruta>       subir (x-upsert)
 *   GET      /object/public/<bucket>/<ruta> ver (público)
 *   GET      /object/<bucket>/<ruta>        ver (con sesión)
 *   DELETE   /object/<bucket>  { prefixes } borrar
 *
 * Regla igual que la carpeta bpos-media: cada negocio sube solo dentro de su
 * carpeta (<negocio>/...); el servidor puede todo; ver es público.
 */
import type { Auth } from "./access";
import type { Db } from "./db";

export type BucketLike = {
  put(key: string, value: ArrayBuffer | ReadableStream | Uint8Array, options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream | null; arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string; cacheControl?: string }; size?: number; httpEtag?: string } | null>;
  head(key: string): Promise<unknown | null>;
  delete(keys: string | string[]): Promise<void>;
};

const PUBLIC_BUCKETS = new Set(["bpos-media"]);
const MAX_BYTES = 10 * 1024 * 1024;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fail = (status: number, error: string, message: string) => json({ statusCode: String(status), error, message }, status);

function cleanPath(path: string) {
  const parts = decodeURIComponent(path).split("/").filter(Boolean);
  if (parts.some((p) => p === ".." || p === ".")) return null;
  return parts.join("/");
}

async function canWrite(db: Db, auth: Auth, bucket: string, key: string) {
  if (auth.role === "service") return true;
  if (auth.role !== "authenticated" || !auth.uid || !PUBLIC_BUCKETS.has(bucket)) return false;
  const business = key.split("/")[0];
  return Boolean(await db.first("SELECT 1 AS ok FROM business_members WHERE business_id = ? AND user_id = ?", [business, auth.uid]));
}

export async function handleStorage(request: Request, path: string, auth: Auth, deps: { db: Db; bucket: BucketLike }): Promise<Response> {
  const m = request.method.toUpperCase();
  const parts = path.replace(/^\/+/, "").split("/");
  if (parts[0] !== "object") return fail(404, "not_found", "Not found");

  // Ver archivo público
  if (parts[1] === "public" && (m === "GET" || m === "HEAD")) {
    const bucket = parts[2];
    const key = cleanPath(parts.slice(3).join("/"));
    if (!bucket || !key || !PUBLIC_BUCKETS.has(bucket)) return fail(400, "not_found", "Bucket not found");
    const obj = await deps.bucket.get(`${bucket}/${key}`);
    if (!obj) return fail(404, "not_found", "Object not found");
    return new Response(m === "HEAD" ? null : obj.body, {
      headers: {
        "content-type": obj.httpMetadata?.contentType || "application/octet-stream",
        "cache-control": obj.httpMetadata?.cacheControl ? `public, max-age=${obj.httpMetadata.cacheControl.replace(/\D/g, "") || "31536000"}` : "public, max-age=31536000",
        ...(obj.httpEtag ? { etag: obj.httpEtag } : {}),
      },
    });
  }

  const bucket = parts[1];
  if (!bucket) return fail(400, "invalid", "Falta el bucket");

  // Borrar varios: DELETE /object/<bucket> { prefixes: [...] }
  if (m === "DELETE" && parts.length === 2) {
    const body = (await request.json().catch(() => ({}))) as { prefixes?: string[] };
    const keys = (body.prefixes || []).map((p) => cleanPath(p)).filter((k): k is string => Boolean(k));
    const allowed: string[] = [];
    for (const k of keys) if (await canWrite(deps.db, auth, bucket, k)) allowed.push(k);
    if (allowed.length) await deps.bucket.delete(allowed.map((k) => `${bucket}/${k}`));
    return json(allowed.map((name) => ({ name, bucket_id: bucket })));
  }

  const key = cleanPath(parts.slice(2).join("/"));
  if (!key) return fail(400, "invalid", "Ruta inválida");

  if (m === "POST" || m === "PUT") {
    if (!(await canWrite(deps.db, auth, bucket, key))) return fail(403, "Unauthorized", "new row violates row-level security policy");
    const upsert = m === "PUT" || request.headers.get("x-upsert") === "true";
    if (!upsert && (await deps.bucket.head(`${bucket}/${key}`))) return fail(409, "Duplicate", "The resource already exists");
    // supabase-js manda el archivo como FormData (navegador) o como cuerpo directo
    let data: ArrayBuffer;
    let contentType = request.headers.get("content-type") || "application/octet-stream";
    let cacheControl = request.headers.get("cache-control") || "";
    if (contentType.startsWith("multipart/form-data")) {
      const form = await request.formData();
      const file = [...form.values()].find((v): v is File => typeof v === "object" && v !== null && "arrayBuffer" in v);
      if (!file) return fail(400, "invalid", "No viene el archivo");
      data = await file.arrayBuffer();
      contentType = file.type || "application/octet-stream";
      cacheControl = String(form.get("cacheControl") || cacheControl);
    } else data = await request.arrayBuffer();
    if (data.byteLength > MAX_BYTES) return fail(413, "Payload too large", "El archivo pesa demasiado (máximo 10 MB).");
    await deps.bucket.put(`${bucket}/${key}`, data, { httpMetadata: { contentType, cacheControl: cacheControl || "3600" } });
    return json({ Key: `${bucket}/${key}`, Id: crypto.randomUUID() });
  }

  if (m === "GET" || m === "HEAD") {
    if (!PUBLIC_BUCKETS.has(bucket) && auth.role !== "service") return fail(403, "Unauthorized", "Unauthorized");
    const obj = await deps.bucket.get(`${bucket}/${key}`);
    if (!obj) return fail(404, "not_found", "Object not found");
    return new Response(m === "HEAD" ? null : obj.body, { headers: { "content-type": obj.httpMetadata?.contentType || "application/octet-stream" } });
  }

  if (m === "DELETE") {
    if (!(await canWrite(deps.db, auth, bucket, key))) return fail(403, "Unauthorized", "Unauthorized");
    await deps.bucket.delete(`${bucket}/${key}`);
    return json({ message: "Successfully deleted" });
  }
  return fail(405, "method_not_allowed", "Método no permitido");
}
