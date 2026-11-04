/**
 * Permiso de uso del Agent (candado contra usar B-POS sin pagar).
 *
 * Con internet, el Agent pide a B-POS (/api/licencia, con su token de
 * vinculación) un permiso firmado por el servidor: "este negocio puede
 * trabajar hasta tal fecha" (lo pagado, y como máximo 3 días sin
 * conectarse). Sin permiso vigente, el Agent no imprime ni abre el cajón
 * por la vía local (la de sin internet). Si el reloj de la computadora se
 * atrasa para alargarlo, también se detiene. La firma se revisa con la
 * llave pública: nadie puede inventar ni alargar un permiso.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/** Llave pública del servidor (GET https://www.bpos.com.mx/api/licencia/llave). Vacía = aún no se revisa. */
const LICENSE_PUBLIC_KEY = "5KjkNdsNnFPRuouWuBRTMsR-hIT4YaZMDt5BxViQ1uU";
const REFRESH_MS = 6 * 60 * 60 * 1000;
const CLOCK_TOLERANCE_MS = 15 * 60 * 1000;

let dataDir = "";
let lastRefresh = 0;

const file = () => path.join(dataDir, "licencia.json");

function readState() {
  try {
    return JSON.parse(fs.readFileSync(file(), "utf8"));
  } catch {
    return {};
  }
}
function writeState(state) {
  try {
    fs.writeFileSync(file(), JSON.stringify(state));
  } catch (error) {
    console.error("No se pudo guardar el permiso:", error.message);
  }
}

function verify(token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig || !LICENSE_PUBLIC_KEY) return null;
  try {
    const key = crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: LICENSE_PUBLIC_KEY }, format: "jwk" });
    const ok = crypto.verify(null, Buffer.from(body, "base64url"), key, Buffer.from(sig, "base64url"));
    return ok ? JSON.parse(Buffer.from(body, "base64url").toString("utf8")) : null;
  } catch {
    return null;
  }
}

function init(dir) {
  dataDir = dir;
}

/** Pide un permiso nuevo (con internet). agentToken: el de la vinculación. */
async function refresh(webUrl, agentToken, force = false) {
  if (!agentToken || (!force && Date.now() - lastRefresh < REFRESH_MS)) return false;
  try {
    const response = await fetch(`${webUrl}/api/licencia`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentToken }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success || !payload.token) return false;
    // Los 3 días se cuentan con la hora del servidor: un reloj mal puesto (o atrasado a propósito
    // antes de renovar) no da más días ni bloquea por error
    const issued = verify(payload.token)?.i;
    const local = Date.now();
    writeState({ ...readState(), token: payload.token, ever: true, seen: local, offset: issued ? issued - local : 0 });
    lastRefresh = Date.now();
    return true;
  } catch {
    return false;
  }
}

/** { ok, reason } — ¿puede imprimir y abrir el cajón ahora? */
function status(now = Date.now()) {
  if (!LICENSE_PUBLIC_KEY) return { ok: true };
  const state = readState();
  const seen = Number(state.seen || 0);
  if (now > seen) writeState({ ...state, seen: now });
  if (seen && now < seen - CLOCK_TOLERANCE_MS) return { ok: false, reason: "La fecha de esta computadora no es correcta." };
  if (!state.token) return state.ever ? { ok: false, reason: "Sin permiso: conecta B-POS a internet." } : { ok: true };
  const payload = verify(state.token);
  if (!payload) return { ok: false, reason: "Permiso no válido: conecta B-POS a internet." };
  if (payload.l) return { ok: false, reason: "El plan de B-POS está en pausa." };
  if (now + Number(state.offset || 0) > payload.u) return { ok: false, reason: "Más de 3 días sin internet: conecta B-POS a internet." };
  return { ok: true };
}

/** Pierde el permiso al desvincular el Agent (al volver a vincularlo pide uno nuevo) */
function clear() {
  const state = readState();
  writeState({ seen: state.seen || 0, ever: Boolean(state.ever) });
}

module.exports = { init, refresh, status, clear };
