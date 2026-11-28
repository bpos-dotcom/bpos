/**
 * Dispositivos conectados (Configuración → Sistema → Dispositivos, 28 nov):
 *  - Cada equipo con B-POS abierto avisa que sigue vivo (bpos_device_ping):
 *    quién es, cuándo entró, la última vez que se usó y la ubicación
 *    aproximada que da Cloudflare por su internet.
 *  - El dueño ve la lista, le pone nombre a cada equipo, cierra sesiones y
 *    elige la caja principal de la sucursal desde cualquier equipo.
 *  - La caja principal vive aquí (nube_branch_primary): si el dueño la cambia,
 *    cada equipo se entera en su siguiente aviso (o al momento, por el toque
 *    "devices-<negocio>" del tiempo real).
 */
import type { Row } from "../db";
import type { RpcCtx, RpcFn } from "../rpc-types";
import { RpcError } from "../rpc-types";
import { requireUser } from "./common";
import { nowIso } from "../values";

/** Los cerrados se siguen viendo una semana (para que el dueño vea que sí se cerró) */
const SHOW_CLOSED_MS = 7 * 86400000;

/** Pantallas de cocina y celulares de meseros nunca son la caja principal */
const NEVER_PRIMARY = ["cocina", "mesero"];

const text = (v: unknown, max = 120) => String(v ?? "").trim().slice(0, max);

async function memberRole(ctx: RpcCtx, businessId: string) {
  const uid = requireUser(ctx);
  const row = await ctx.db.first<{ role: string }>("SELECT role FROM business_members WHERE business_id = ? AND user_id = ?", [businessId, uid]);
  if (!row) throw new RpcError("No tienes acceso a ese negocio.", 403, "42501");
  return { uid, role: row.role };
}

/** Solo el dueño (no los equipos de meseros o cocina) maneja los dispositivos */
async function requireManager(ctx: RpcCtx, businessId: string) {
  const m = await memberRole(ctx, businessId);
  if (m.role === "device") throw new RpcError("Solo el dueño puede manejar los dispositivos.", 403, "42501");
  return m;
}

const touchDevices = (ctx: RpcCtx, businessId: string) => ctx.broadcast?.([{ topic: `devices-${businessId}`, event: "check", payload: {} }]);

async function primaryOf(ctx: RpcCtx, businessId: string, branchId: string | null) {
  if (!branchId) return null;
  return ctx.db.first<{ device_id: string | null }>("SELECT device_id FROM nube_branch_primary WHERE business_id = ? AND branch_id = ?", [businessId, branchId]);
}

/** Cierra en la nube la sesión de ese equipo (sus llaves para renovar ya no sirven) */
async function closeDevice(ctx: RpcCtx, businessId: string, device: { device_id: string; user_id: string; session_id: string | null }) {
  const now = nowIso();
  await ctx.db.run("UPDATE nube_devices SET revoked_at = ?, revoked_session = session_id WHERE business_id = ? AND device_id = ?", [now, businessId, device.device_id]);
  if (device.session_id) await ctx.db.run("UPDATE nube_refresh_tokens SET revoked = 1 WHERE session_id = ? AND user_id = ?", [device.session_id, device.user_id]);
}

/**
 * Aviso de vida de un equipo. Regresa si su sesión se cerró desde la lista y
 * si es la caja principal de su sucursal.
 */
const ping: RpcFn = async (ctx, args) => {
  const businessId = text(args.p_business_id, 64);
  const deviceId = text(args.p_device_id, 64);
  if (!businessId || !deviceId) throw new RpcError("Faltan datos del dispositivo.");
  const { uid } = await memberRole(ctx, businessId);
  const branchId = text(args.p_branch_id, 64) || null;
  const sessionId = text(args.p_session_id, 64) || null;
  const now = nowIso();
  const old = await ctx.db.first<{ revoked_at: string | null; revoked_session: string | null; first_seen_at: string; name: string }>(
    "SELECT revoked_at, revoked_session, first_seen_at, name FROM nube_devices WHERE business_id = ? AND device_id = ?",
    [businessId, deviceId]
  );
  // Cerrado desde la lista: hasta que vuelva a entrar con su contraseña (otra sesión)
  if (old?.revoked_at && (!sessionId || sessionId === old.revoked_session)) return { revoked: true, primary: false };
  const geo = ctx.geo || {};
  const fresh = !old || Boolean(old.revoked_at);
  await ctx.db.run(
    `INSERT INTO nube_devices (business_id, device_id, branch_id, user_id, email, label, kind, session_id, first_seen_at, last_seen_at, ip, city, region, country, revoked_at, revoked_session)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
     ON CONFLICT (business_id, device_id) DO UPDATE SET
       branch_id = excluded.branch_id, user_id = excluded.user_id, email = excluded.email, label = excluded.label, kind = excluded.kind,
       session_id = excluded.session_id, last_seen_at = excluded.last_seen_at,
       first_seen_at = CASE WHEN nube_devices.revoked_at IS NOT NULL THEN excluded.first_seen_at ELSE nube_devices.first_seen_at END,
       ip = COALESCE(excluded.ip, nube_devices.ip), city = COALESCE(excluded.city, nube_devices.city),
       region = COALESCE(excluded.region, nube_devices.region), country = COALESCE(excluded.country, nube_devices.country),
       revoked_at = NULL, revoked_session = NULL`,
    [businessId, deviceId, branchId, uid, ctx.auth.email ?? null, text(args.p_label), text(args.p_kind, 30) || "navegador", sessionId, fresh ? now : old!.first_seen_at, now, geo.ip ?? null, geo.city ?? null, geo.region ?? null, geo.country ?? null]
  );
  let primary = false;
  if (branchId && !NEVER_PRIMARY.includes(text(args.p_kind, 30))) {
    const current = await primaryOf(ctx, businessId, branchId);
    if (current) primary = current.device_id === deviceId;
    else if (args.p_role === "primary") {
      // Todavía no se eligió en la nube: la primera que ya era principal se queda con el lugar
      await ctx.db.run("INSERT INTO nube_branch_primary (business_id, branch_id, device_id, set_at, set_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING", [businessId, branchId, deviceId, now, "automatico"]);
      primary = (await primaryOf(ctx, businessId, branchId))?.device_id === deviceId;
    }
  }
  return { revoked: false, primary, name: old?.name || "" };
};

const list: RpcFn = async (ctx, args) => {
  const businessId = text(args.p_business_id, 64);
  await requireManager(ctx, businessId);
  const since = new Date(Date.now() - SHOW_CLOSED_MS).toISOString();
  const rows = await ctx.db.all<Row>(
    `SELECT d.device_id, d.branch_id, d.email, d.name, d.label, d.kind, d.first_seen_at, d.last_seen_at, d.ip, d.city, d.region, d.country, d.revoked_at,
            (SELECT name FROM branches b WHERE b.id = d.branch_id) AS branch_name,
            CASE WHEN p.device_id = d.device_id THEN 1 ELSE 0 END AS is_primary
       FROM nube_devices d LEFT JOIN nube_branch_primary p ON p.business_id = d.business_id AND p.branch_id = d.branch_id
      WHERE d.business_id = ? AND (d.revoked_at IS NULL OR d.revoked_at > ?)
      ORDER BY d.revoked_at IS NOT NULL, d.last_seen_at DESC`,
    [businessId, since]
  );
  return rows.map((r) => ({ ...r, is_primary: Number(r.is_primary) === 1 }));
};

/** Caja principal de la sucursal (null = ninguna) */
const setPrimary: RpcFn = async (ctx, args) => {
  const businessId = text(args.p_business_id, 64);
  const { uid } = await requireManager(ctx, businessId);
  const deviceId = text(args.p_device_id, 64) || null;
  let branchId = text(args.p_branch_id, 64) || null;
  if (deviceId) {
    const d = await ctx.db.first<{ branch_id: string | null; revoked_at: string | null; kind: string }>("SELECT branch_id, revoked_at, kind FROM nube_devices WHERE business_id = ? AND device_id = ?", [businessId, deviceId]);
    if (!d || d.revoked_at) throw new RpcError("Ese dispositivo ya no está conectado.");
    if (NEVER_PRIMARY.includes(d.kind)) throw new RpcError("Una pantalla de cocina o de mesero no puede ser la caja principal.");
    branchId = d.branch_id;
  }
  if (!branchId || !(await ctx.db.first("SELECT 1 AS ok FROM branches WHERE id = ? AND business_id = ?", [branchId, businessId]))) throw new RpcError("No se encontró la sucursal de ese dispositivo.");
  await ctx.db.run(
    "INSERT INTO nube_branch_primary (business_id, branch_id, device_id, set_at, set_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT (business_id, branch_id) DO UPDATE SET device_id = excluded.device_id, set_at = excluded.set_at, set_by = excluded.set_by",
    [businessId, branchId, deviceId, nowIso(), uid]
  );
  await touchDevices(ctx, businessId);
  return { primary: deviceId };
};

const rename: RpcFn = async (ctx, args) => {
  const businessId = text(args.p_business_id, 64);
  await requireManager(ctx, businessId);
  await ctx.db.run("UPDATE nube_devices SET name = ? WHERE business_id = ? AND device_id = ?", [text(args.p_name, 40), businessId, text(args.p_device_id, 64)]);
  return undefined;
};

/**
 * Cierra la sesión de un equipo, o la de todos los demás de la misma cuenta
 * (p_except_device_id). Los de meseros y cocina tienen su propia cuenta: no se tocan.
 */
const close: RpcFn = async (ctx, args) => {
  const businessId = text(args.p_business_id, 64);
  const { uid } = await requireManager(ctx, businessId);
  const except = text(args.p_except_device_id, 64);
  const one = text(args.p_device_id, 64);
  if (!one && !except) throw new RpcError("Falta el dispositivo.");
  const rows = one
    ? await ctx.db.all<{ device_id: string; user_id: string; session_id: string | null }>("SELECT device_id, user_id, session_id FROM nube_devices WHERE business_id = ? AND device_id = ? AND revoked_at IS NULL", [businessId, one])
    : await ctx.db.all<{ device_id: string; user_id: string; session_id: string | null }>("SELECT device_id, user_id, session_id FROM nube_devices WHERE business_id = ? AND device_id <> ? AND user_id = ? AND revoked_at IS NULL", [businessId, except, uid]);
  for (const d of rows) await closeDevice(ctx, businessId, d);
  // La caja principal que se cerró deja libre el lugar
  if (rows.length) {
    const ids = rows.map((r) => r.device_id);
    await ctx.db.run(`UPDATE nube_branch_primary SET device_id = NULL, set_at = ? WHERE business_id = ? AND device_id IN (${ids.map(() => "?").join(", ")})`, [nowIso(), businessId, ...ids]);
  }
  await touchDevices(ctx, businessId);
  return { closed: rows.length };
};

export const DEVICES_RPC: Record<string, RpcFn> = {
  bpos_device_ping: ping,
  bpos_devices_list: list,
  bpos_device_set_primary: setPrimary,
  bpos_device_rename: rename,
  bpos_device_close: close,
};
