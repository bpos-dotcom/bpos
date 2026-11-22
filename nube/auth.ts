/**
 * /auth/v1 compatible con Supabase Auth (lo que usa supabase-js):
 *   POST /token?grant_type=password | refresh_token
 *   GET/PUT /user   POST /signup   POST /logout   GET /settings
 *   /admin/users[/:id] (solo con la llave del servidor)
 *
 * Los usuarios viven en nube_users con la misma contraseña (bcrypt, igual que
 * Supabase: se copian tal cual y nadie tiene que volver a registrarse). La
 * sesión es un JWT HS256 de 1 hora y un refresh token que se cambia en cada uso.
 */
import bcrypt from "bcryptjs";
import type { Db, Row } from "./db";
import type { Auth } from "./access";
import type { Reply } from "./rest";
import { nowIso } from "./values";

export const ACCESS_TTL_S = 3600;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "x-supabase-api-version": "2024-01-01" };

export type AuthEnv = { jwtSecret: string; serviceKey: string; anonKey: string; issuer: string };

// ------------------------------------------------------------ JWT (HS256)

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlJson = (o: unknown) => b64url(enc.encode(JSON.stringify(o)));
function fromB64url(s: string) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}
const keyCache = new Map<string, Promise<CryptoKey>>();
function hmacKey(secret: string) {
  if (!keyCache.has(secret)) keyCache.set(secret, crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]));
  return keyCache.get(secret)!;
}

export async function signJwt(payload: Record<string, unknown>, secret: string) {
  const head = b64urlJson({ alg: "HS256", typ: "JWT" });
  const body = b64urlJson(payload);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

export async function verifyJwt(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[1]))) as Record<string, unknown>;
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Quién llama: llave del servidor, sesión de usuario o nadie */
export async function authFromRequest(headers: Headers, env: AuthEnv): Promise<Auth> {
  const bearer = (headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const apikey = (headers.get("apikey") || "").trim();
  if ((bearer && bearer === env.serviceKey) || (!bearer && apikey === env.serviceKey)) return { role: "service", uid: null };
  if (bearer && bearer !== env.anonKey) {
    const claims = await verifyJwt(bearer, env.jwtSecret);
    if (claims?.role === "service_role") return { role: "service", uid: null };
    if (claims && typeof claims.sub === "string") return { role: "authenticated", uid: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
  }
  return { role: "anon", uid: null };
}

// ------------------------------------------------------------ usuarios

type UserRow = { id: string; email: string; encrypted_password: string; email_confirmed_at: string | null; user_metadata: string; app_metadata: string; banned_until: string | null; last_sign_in_at: string | null; created_at: string; updated_at: string };

const parse = (s: string | null | undefined) => {
  try {
    return s ? (JSON.parse(s) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** El usuario como lo devuelve Supabase */
export function publicUser(u: UserRow) {
  return {
    id: u.id,
    aud: "authenticated",
    role: "authenticated",
    email: u.email,
    email_confirmed_at: u.email_confirmed_at,
    phone: "",
    confirmed_at: u.email_confirmed_at,
    last_sign_in_at: u.last_sign_in_at,
    app_metadata: { provider: "email", providers: ["email"], ...parse(u.app_metadata) },
    user_metadata: parse(u.user_metadata),
    identities: [],
    created_at: u.created_at,
    updated_at: u.updated_at,
    is_anonymous: false,
  };
}

const fail = (status: number, code: string, msg: string): Reply => ({ status, headers: JSON_HEADERS, body: JSON.stringify({ code, error_code: code, msg }) });
const ok = (body: unknown, status = 200): Reply => ({ status, headers: JSON_HEADERS, body: JSON.stringify(body) });

const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return b64url(bytes);
};

export const hashPassword = (password: string) => bcrypt.hash(password, 10);

async function issueSession(db: Db, env: AuthEnv, user: UserRow, sessionId: string = crypto.randomUUID()) {
  const now = Math.floor(Date.now() / 1000);
  const access = await signJwt(
    {
      iss: env.issuer,
      sub: user.id,
      aud: "authenticated",
      role: "authenticated",
      email: user.email,
      phone: "",
      iat: now,
      exp: now + ACCESS_TTL_S,
      session_id: sessionId,
      aal: "aal1",
      is_anonymous: false,
      app_metadata: { provider: "email", providers: ["email"], ...parse(user.app_metadata) },
      user_metadata: parse(user.user_metadata),
    },
    env.jwtSecret
  );
  const refresh = randomToken();
  await db.run("INSERT INTO nube_refresh_tokens (token, user_id, session_id, revoked, created_at) VALUES (?, ?, ?, 0, ?)", [refresh, user.id, sessionId, nowIso()]);
  return { access_token: access, token_type: "bearer", expires_in: ACCESS_TTL_S, expires_at: now + ACCESS_TTL_S, refresh_token: refresh, user: publicUser(user) };
}

const userById = (db: Db, id: string) => db.first<UserRow>("SELECT * FROM nube_users WHERE id = ?", [id]);
const userByEmail = (db: Db, email: string) => db.first<UserRow>("SELECT * FROM nube_users WHERE email = ?", [email.trim().toLowerCase()]);

export async function createUser(db: Db, input: { email: string; password?: string; confirmed: boolean; userMetadata?: unknown; appMetadata?: unknown; id?: string; passwordHash?: string }) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: fail(400, "validation_failed", "Unable to validate email address: invalid format") };
  if (await userByEmail(db, email)) return { error: fail(422, "email_exists", "A user with this email address has already been registered") };
  if (input.password !== undefined && input.password.length < 6) return { error: fail(422, "weak_password", "Password should be at least 6 characters.") };
  const now = nowIso();
  const id = input.id || crypto.randomUUID();
  const hash = input.passwordHash ?? (input.password ? await hashPassword(input.password) : "");
  await db.run(
    "INSERT INTO nube_users (id, email, encrypted_password, email_confirmed_at, user_metadata, app_metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [id, email, hash, input.confirmed ? now : null, JSON.stringify(input.userMetadata || {}), JSON.stringify(input.appMetadata || {}), now, now]
  );
  return { user: (await userById(db, id))! };
}

// ------------------------------------------------------------ rutas

export async function handleAuth(db: Db, env: AuthEnv, auth: Auth, method: string, path: string, params: URLSearchParams, body: Row): Promise<Reply> {
  const m = method.toUpperCase();
  try {
    if (path === "/settings" && m === "GET") return ok({ external: { email: true }, disable_signup: false, mailer_autoconfirm: true, phone_autoconfirm: false });
    if (path === "/health" && m === "GET") return ok({ name: "nube", version: "1" });

    if (path === "/token" && m === "POST") {
      const grant = params.get("grant_type");
      if (grant === "password") {
        const user = await userByEmail(db, String(body.email || ""));
        const password = String(body.password || "");
        if (!user || !user.encrypted_password || !(await bcrypt.compare(password, user.encrypted_password))) return fail(400, "invalid_credentials", "Invalid login credentials");
        if (!user.email_confirmed_at) return fail(400, "email_not_confirmed", "Email not confirmed");
        if (user.banned_until && Date.parse(user.banned_until) > Date.now()) return fail(400, "user_banned", "User is banned");
        await db.run("UPDATE nube_users SET last_sign_in_at = ? WHERE id = ?", [nowIso(), user.id]);
        return ok(await issueSession(db, env, { ...user, last_sign_in_at: nowIso() }));
      }
      if (grant === "refresh_token") {
        const token = String(body.refresh_token || "");
        const row = await db.first<{ token: string; user_id: string; session_id: string; revoked: number; used_at: string | null }>("SELECT * FROM nube_refresh_tokens WHERE token = ?", [token]);
        if (!row || row.revoked) return fail(400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
        // Usado hace menos de 10 s: otra pestaña lo cambió al mismo tiempo; se acepta (como Supabase)
        if (row.used_at && Date.now() - Date.parse(row.used_at) > 10_000) {
          await db.run("UPDATE nube_refresh_tokens SET revoked = 1 WHERE session_id = ?", [row.session_id]);
          return fail(400, "refresh_token_already_used", "Invalid Refresh Token: Already Used");
        }
        const user = await userById(db, row.user_id);
        if (!user) return fail(400, "user_not_found", "User from sub claim in JWT does not exist");
        await db.run("UPDATE nube_refresh_tokens SET used_at = COALESCE(used_at, ?) WHERE token = ?", [nowIso(), token]);
        return ok(await issueSession(db, env, user, row.session_id));
      }
      return fail(400, "unsupported_grant_type", "unsupported_grant_type");
    }

    if (path === "/signup" && m === "POST") {
      const created = await createUser(db, { email: String(body.email || ""), password: String(body.password || ""), confirmed: true, userMetadata: body.data });
      if (created.error) return created.error;
      return ok(await issueSession(db, env, created.user));
    }

    if (path === "/user") {
      if (auth.role !== "authenticated" || !auth.uid) return fail(401, "no_authorization", "This endpoint requires a valid Bearer token");
      const user = await userById(db, auth.uid);
      if (!user) return fail(403, "user_not_found", "User from sub claim in JWT does not exist");
      if (m === "GET") return ok(publicUser(user));
      if (m === "PUT") {
        if (typeof body.password === "string") {
          if (body.password.length < 6) return fail(422, "weak_password", "Password should be at least 6 characters.");
          await db.run("UPDATE nube_users SET encrypted_password = ?, updated_at = ? WHERE id = ?", [await hashPassword(body.password), nowIso(), user.id]);
        }
        if (body.data && typeof body.data === "object") {
          await db.run("UPDATE nube_users SET user_metadata = ?, updated_at = ? WHERE id = ?", [JSON.stringify({ ...parse(user.user_metadata), ...(body.data as Row) }), nowIso(), user.id]);
        }
        return ok(publicUser((await userById(db, user.id))!));
      }
    }

    if (path === "/logout" && m === "POST") {
      if (auth.role === "authenticated" && auth.uid) {
        const scope = params.get("scope") || "global";
        if (scope === "global" || scope === "others") await db.run("UPDATE nube_refresh_tokens SET revoked = 1 WHERE user_id = ?", [auth.uid]);
      }
      return { status: 204, headers: {}, body: null };
    }

    // ---- admin (llave del servidor)
    if (path.startsWith("/admin/users")) {
      if (auth.role !== "service") return fail(403, "not_admin", "User not allowed");
      const id = decodeURIComponent(path.slice("/admin/users".length).replace(/^\//, ""));
      if (!id && m === "POST") {
        const created = await createUser(db, {
          email: String(body.email || ""),
          password: typeof body.password === "string" ? body.password : undefined,
          confirmed: body.email_confirm === true,
          userMetadata: body.user_metadata,
          appMetadata: body.app_metadata,
        });
        return created.error || ok(publicUser(created.user));
      }
      if (!id && m === "GET") {
        const page = Math.max(1, Number(params.get("page") || 1));
        const perPage = Math.min(1000, Math.max(1, Number(params.get("per_page") || 50)));
        const users = await db.all<UserRow>("SELECT * FROM nube_users ORDER BY created_at LIMIT ? OFFSET ?", [perPage, (page - 1) * perPage]);
        return ok({ users: users.map(publicUser), aud: "authenticated" });
      }
      const user = id ? await userById(db, id) : null;
      if (!user) return fail(404, "user_not_found", "User not found");
      if (m === "GET") return ok(publicUser(user));
      if (m === "DELETE") {
        await db.batch([
          { sql: "DELETE FROM nube_refresh_tokens WHERE user_id = ?", params: [id] },
          { sql: "DELETE FROM nube_users WHERE id = ?", params: [id] },
        ]);
        return ok({});
      }
      if (m === "PUT") {
        const sets: string[] = [];
        const values: unknown[] = [];
        if (typeof body.password === "string") {
          sets.push("encrypted_password = ?");
          values.push(await hashPassword(body.password));
        }
        if (typeof body.email === "string") {
          sets.push("email = ?");
          values.push(body.email.trim().toLowerCase());
        }
        if (body.email_confirm === true) {
          sets.push("email_confirmed_at = COALESCE(email_confirmed_at, ?)");
          values.push(nowIso());
        }
        if (body.user_metadata && typeof body.user_metadata === "object") {
          sets.push("user_metadata = ?");
          values.push(JSON.stringify(body.user_metadata));
        }
        if (typeof body.ban_duration === "string") {
          sets.push("banned_until = ?");
          values.push(body.ban_duration === "none" ? null : new Date(Date.now() + 100 * 365 * 86400000).toISOString());
        }
        if (sets.length) await db.run(`UPDATE nube_users SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`, [...values, nowIso(), id]);
        return ok(publicUser((await userById(db, id))!));
      }
    }
    return fail(404, "not_found", `Not found: ${m} ${path}`);
  } catch (e) {
    return fail(500, "unexpected_failure", e instanceof Error ? e.message : String(e));
  }
}
