/**
 * Dispositivos conectados (28 nov): lista de equipos, cerrar sesiones,
 * caja principal elegida en la nube y limpieza de llaves gastadas.
 *   npx tsx scripts/test-dispositivos.ts
 */
import { checker, makeHarness, seedBusiness } from "./nube-harness";
import { cleanupTokens } from "../nube/auth";
import { geoOf } from "../nube/router";
import { agoText, deviceLabel, isOnline, placeOf, sessionIdOf } from "../lib/cloud/devices";

const { check, done } = checker();

async function main() {
  const h = await makeHarness();
  const a = await seedBusiness(h, "dueno@prueba.mx");
  const b = await seedBusiness(h, "otro@prueba.mx");
  const pc = await h.signIn("dueno@prueba.mx", "secreta123");
  const cel = await h.signIn("dueno@prueba.mx", "secreta123");
  const otro = await h.signIn("otro@prueba.mx", "secreta123");
  const sid = async (c: typeof pc) => sessionIdOf((await c.auth.getSession()).data.session!.access_token);
  const ping = async (c: typeof pc, device: string, extra: Record<string, unknown> = {}) =>
    c.rpc("bpos_device_ping", { p_business_id: a.businessId, p_branch_id: a.branchId, p_device_id: device, p_label: "Chrome en Windows", p_kind: "navegador", p_session_id: await sid(c), p_role: "secondary", ...extra });

  // ---------------------------------------------------------------- avisos de vida
  check("el token trae el número de sesión", typeof (await sid(pc)) === "string");
  const p1 = await ping(pc, "dev-pc", { p_role: "primary" });
  check("la PC avisa que está viva", !p1.error && p1.data?.revoked === false, p1.error);
  check("la PC que ya era principal se queda con el lugar", p1.data?.primary === true, p1.data);
  const p2 = await ping(cel, "dev-cel", { p_label: "App Dueño (Android)", p_kind: "app-dueno", p_role: "primary" });
  check("otro equipo que también decía ser principal ya no lo es", p2.data?.primary === false, p2.data);
  const intruso = await otro.rpc("bpos_device_ping", { p_business_id: a.businessId, p_branch_id: a.branchId, p_device_id: "dev-x", p_session_id: null });
  check("alguien de otro negocio no puede avisar en este", Boolean(intruso.error));

  const l1 = await pc.rpc("bpos_devices_list", { p_business_id: a.businessId });
  check("la lista trae los 2 equipos", !l1.error && l1.data?.length === 2, l1.error || l1.data);
  const pcRow = l1.data?.find((d: { device_id: string }) => d.device_id === "dev-pc");
  check("con cuenta, sucursal, fecha de entrada y caja principal", pcRow?.email === "dueno@prueba.mx" && pcRow?.branch_name === "Centro" && Boolean(pcRow?.first_seen_at) && pcRow?.is_primary === true, pcRow);
  check("otro negocio no ve la lista", Boolean((await otro.rpc("bpos_devices_list", { p_business_id: a.businessId })).error));

  // ---------------------------------------------------------------- nombre
  await pc.rpc("bpos_device_rename", { p_business_id: a.businessId, p_device_id: "dev-pc", p_name: "Caja mostrador" });
  const l2 = await pc.rpc("bpos_devices_list", { p_business_id: a.businessId });
  check("se le pone nombre", l2.data?.find((d: { device_id: string }) => d.device_id === "dev-pc")?.name === "Caja mostrador");
  await ping(pc, "dev-pc");
  const l2b = await pc.rpc("bpos_devices_list", { p_business_id: a.businessId });
  check("el nombre no se pierde con el siguiente aviso", l2b.data?.find((d: { device_id: string }) => d.device_id === "dev-pc")?.name === "Caja mostrador");

  // ---------------------------------------------------------------- caja principal desde la lista
  await ping(cel, "dev-caja", { p_label: "Chrome en Windows" });
  const before = h.broadcasts.length;
  const sp = await cel.rpc("bpos_device_set_primary", { p_business_id: a.businessId, p_branch_id: a.branchId, p_device_id: "dev-caja" });
  check("desde el celular se elige otra caja principal", !sp.error, sp.error);
  check("y se avisa por tiempo real a los equipos", h.broadcasts.slice(before).some((m) => m.topic === `devices-${a.businessId}` && m.event === "check"));
  check("la caja nueva se entera en su aviso", (await ping(cel, "dev-caja")).data?.primary === true);
  check("la PC deja de serlo aunque diga que sí", (await ping(pc, "dev-pc", { p_role: "primary" })).data?.primary === false);
  await cel.rpc("bpos_device_set_primary", { p_business_id: a.businessId, p_branch_id: a.branchId, p_device_id: null });
  check("sin caja principal: nadie la toma solo", (await ping(cel, "dev-caja", { p_role: "primary" })).data?.primary === false);
  await ping(cel, "dev-kds", { p_kind: "cocina" });
  check("una pantalla de cocina no puede ser principal", Boolean((await pc.rpc("bpos_device_set_primary", { p_business_id: a.businessId, p_branch_id: a.branchId, p_device_id: "dev-kds" })).error));
  await pc.rpc("bpos_device_set_primary", { p_business_id: a.businessId, p_branch_id: a.branchId, p_device_id: "dev-caja" });

  // ---------------------------------------------------------------- cerrar sesión
  const celSession = await sid(cel);
  const c1 = await pc.rpc("bpos_device_close", { p_business_id: a.businessId, p_device_id: "dev-caja" });
  check("se cierra la sesión de un equipo", !c1.error && c1.data?.closed === 1, c1.error || c1.data);
  check("el equipo cerrado se entera en su aviso", (await ping(cel, "dev-caja")).data?.revoked === true);
  const tokens = await h.db.all<{ revoked: number }>("SELECT revoked FROM nube_refresh_tokens WHERE session_id = ?", [celSession]);
  check("y su llave para renovar ya no sirve", tokens.length > 0 && tokens.every((t) => t.revoked === 1), tokens);
  const refresh = await cel.auth.refreshSession();
  check("ya no puede renovar la sesión", Boolean(refresh.error));
  const primaryRow = await h.db.first<{ device_id: string | null }>("SELECT device_id FROM nube_branch_primary WHERE business_id = ?", [a.businessId]);
  check("la caja principal que se cerró deja libre el lugar", primaryRow?.device_id === null, primaryRow);
  const l3 = await pc.rpc("bpos_devices_list", { p_business_id: a.businessId });
  check("en la lista sale como cerrada", Boolean(l3.data?.find((d: { device_id: string }) => d.device_id === "dev-caja")?.revoked_at));
  const pcStill = await ping(pc, "dev-pc");
  check("la PC que cerró la otra sigue abierta", pcStill.data?.revoked === false);

  // Vuelve a entrar con su contraseña (otra sesión) en el mismo equipo
  const cel2 = await h.signIn("dueno@prueba.mx", "secreta123");
  const back = await ping(cel2, "dev-caja");
  check("al volver a entrar ya no sale cerrado", back.data?.revoked === false, back.data);

  // ---------------------------------------------------------------- cerrar los demás
  const tablet = await h.signIn("dueno@prueba.mx", "secreta123");
  await ping(tablet, "dev-tablet");
  const mesero = await seedWaiter(h, a.businessId);
  await mesero.rpc("bpos_device_ping", { p_business_id: a.businessId, p_branch_id: a.branchId, p_device_id: "dev-mesero", p_kind: "mesero", p_session_id: await sid(mesero) });
  check("el equipo de mesero no puede ver la lista", Boolean((await mesero.rpc("bpos_devices_list", { p_business_id: a.businessId })).error));
  const all = await pc.rpc("bpos_device_close", { p_business_id: a.businessId, p_except_device_id: "dev-pc" });
  check("cerrar todos los demás de la cuenta", !all.error && all.data?.closed >= 3, all.error || all.data);
  check("la PC que lo pidió sigue abierta", (await ping(pc, "dev-pc")).data?.revoked === false);
  check("la tablet se cierra", (await ping(tablet, "dev-tablet")).data?.revoked === true);
  check("el mesero (otra cuenta) no se toca", (await mesero.rpc("bpos_device_ping", { p_business_id: a.businessId, p_branch_id: a.branchId, p_device_id: "dev-mesero", p_kind: "mesero", p_session_id: await sid(mesero) })).data?.revoked === false);
  check("el otro negocio no se toca", !(await h.db.first("SELECT 1 AS ok FROM nube_devices WHERE business_id = ? AND revoked_at IS NOT NULL", [b.businessId])));

  // ---------------------------------------------------------------- limpieza de llaves
  const uid = a.uid;
  const old = new Date(Date.now() - 2 * 86400000).toISOString();
  const veryOld = new Date(Date.now() - 40 * 86400000).toISOString();
  await h.db.batch([
    { sql: "INSERT INTO nube_refresh_tokens (token, user_id, session_id, revoked, created_at, used_at) VALUES ('gastada', ?, 'ses-viva', 0, ?, ?)", params: [uid, old, old] },
    { sql: "INSERT INTO nube_refresh_tokens (token, user_id, session_id, revoked, created_at, used_at) VALUES ('actual', ?, 'ses-viva', 0, ?, NULL)", params: [uid, old] },
    { sql: "INSERT INTO nube_refresh_tokens (token, user_id, session_id, revoked, created_at, used_at) VALUES ('abandonada', ?, 'ses-vieja', 0, ?, NULL)", params: [uid, veryOld] },
    { sql: "INSERT INTO nube_refresh_tokens (token, user_id, session_id, revoked, created_at, used_at) VALUES ('ajena', ?, 'ses-ajena', 0, ?, ?)", params: [b.uid, old, old] },
  ]);
  await cleanupTokens(h.db, uid);
  const left = async (t: string) => h.db.first<{ revoked: number }>("SELECT revoked FROM nube_refresh_tokens WHERE token = ?", [t]);
  check("borra la llave ya gastada", !(await left("gastada")));
  check("deja la llave actual de una sesión en uso", (await left("actual"))?.revoked === 0);
  const abandoned = await left("abandonada");
  check("cierra la sesión abandonada (30 días) y la borra", !abandoned || abandoned.revoked === 1, abandoned);
  check("no toca las de otro usuario", Boolean(await left("ajena")));
  const pcRefresh = await pc.auth.refreshSession();
  check("la PC sigue renovando su sesión después de limpiar", !pcRefresh.error, pcRefresh.error);

  // ---------------------------------------------------------------- nombres y textos
  const andr = deviceLabel({ ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36", platform: "Android" });
  check("Chrome del celular en modo escritorio: Android", andr.label === "Chrome en Android" && andr.kind === "navegador", andr);
  check("Samsung Internet", deviceLabel({ ua: "Mozilla/5.0 (Linux; Android 14) SamsungBrowser/26.0 Chrome/122 Mobile Safari/537.36" }).label === "Samsung Internet en Android");
  check("la APK del dueño", deviceLabel({ ua: "Mozilla/5.0 (Linux; Android 14; wv) Chrome/131 Mobile Safari/537.36 BPOSDueno/1.0", cajaKind: "android" }).label === "App Dueño (Android)");
  check("la caja local del Agent", deviceLabel({ ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131 Electron/33 Safari/537.36", cajaKind: "agent" }).kind === "caja-local");
  check("Edge en Windows", deviceLabel({ ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131 Safari/537.36 Edg/131" }).label === "Edge en Windows");
  check("Brave en Windows", deviceLabel({ ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131 Safari/537.36", brave: true }).label === "Brave en Windows");
  check("pantalla de cocina", deviceLabel({ ua: "Mozilla/5.0 (Windows NT 10.0) Chrome/131", path: "/kds/abc" }).kind === "cocina");
  check("lugar", placeOf({ city: "Monterrey", region: "Nuevo León", country: "MX" }) === "Monterrey, Nuevo León · MX");
  check("lugar sin ciudad", placeOf({ city: null, region: null, country: "MX" }) === "MX");
  const now = Date.parse("2026-11-28T20:00:00Z");
  check("hace 5 min", agoText("2026-11-28T19:55:00Z", now) === "hace 5 min");
  check("hace 3 días", agoText("2026-11-25T20:00:00Z", now) === "hace 3 días");
  check("en uso si avisó hace 3 min", isOnline("2026-11-28T19:57:00Z", now) && !isOnline("2026-11-28T19:50:00Z", now));
  check("sessionIdOf con token roto", sessionIdOf("roto") === null);

  const req = new Request("http://x/", { headers: { "cf-connecting-ip": "189.1.2.3" } });
  Object.defineProperty(req, "cf", { value: { city: "Saltillo", region: "Coahuila", country: "MX" } });
  const g = geoOf(req);
  check("ubicación que da Cloudflare", g.ip === "189.1.2.3" && g.city === "Saltillo" && g.region === "Coahuila" && g.country === "MX", g);

  done();
}

/** Cuenta de un celular de mesero (miembro "device" del negocio) */
async function seedWaiter(h: Awaited<ReturnType<typeof makeHarness>>, businessId: string) {
  const { createUser } = await import("../nube/auth");
  const created = await createUser(h.db, { email: "mesero@prueba.mx", password: "secreta123", confirmed: true });
  await h.db.run("INSERT INTO business_members (business_id, user_id, role, created_at) VALUES (?, ?, 'device', ?)", [businessId, created.user!.id, new Date().toISOString()]);
  return h.signIn("mesero@prueba.mx", "secreta123");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
