/**
 * Bloque 11 · API segura para /api/bridge/*.
 *
 * Quién puede llamar:
 *  - Las pantallas de B-POS de un dispositivo conectado a la cuenta del
 *    negocio: mandan su sesión de Supabase (ver lib/bridge/bridge-fetch.ts)
 *    y aquí se revisa que la cuenta sea miembro de un negocio.
 *  - B-POS Agent en esta misma computadora: manda la llave guardada en
 *    ~/.bpos/agent-key (este servidor la crea la primera vez).
 *
 * Mientras se reinstala el Agent con la llave, se acepta el Agent viejo
 * (sin llave) solo para entregar pedidos (POST /api/bridge/orders).
 * Con BPOS_REQUIRE_AGENT_KEY=1 en .env.local se deja de aceptar.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCloudConfigured, SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/client";

export const AGENT_KEY_HEADER = "x-bpos-agent-key";
const AGENT_KEY_FILE = path.join(os.homedir(), ".bpos", "agent-key");
const CACHE_MS = 5 * 60 * 1000;

let agentKey: string | null = null;
const verified = new Map<string, number>(); // token → vence

/** Llave del Agent; se crea la primera vez y se guarda para que el Agent la lea. */
export function getAgentKey(fresh = false) {
  if (agentKey && !fresh) return agentKey;
  try {
    agentKey = fs.readFileSync(AGENT_KEY_FILE, "utf8").trim() || null;
  } catch {
    agentKey = null;
  }
  if (!agentKey) {
    agentKey = crypto.randomBytes(32).toString("hex");
    fs.mkdirSync(path.dirname(AGENT_KEY_FILE), { recursive: true });
    fs.writeFileSync(AGENT_KEY_FILE, agentKey, { encoding: "utf8", mode: 0o600 });
  }
  return agentKey;
}

function sameKey(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Páginas de otros sitios web no pueden usar la API desde el navegador de alguien. */
function isCrossSite(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== request.headers.get("host");
  } catch {
    return true;
  }
}

/** ¿La sesión de Supabase es de una cuenta que pertenece a un negocio? */
async function isBusinessSession(token: string) {
  const now = Date.now();
  const until = verified.get(token);
  if (until && until > now) return true;

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: user, error } = await supabase.auth.getUser(token);
  if (error || !user.user) return false;
  // business_members solo deja ver las filas propias (RLS)
  const { data: member } = await supabase.from("business_members").select("business_id").eq("user_id", user.user.id).limit(1);
  if (!member || member.length === 0) return false;

  if (verified.size > 500) verified.clear();
  verified.set(token, now + CACHE_MS);
  return true;
}

function deny(status: number, error: string) {
  return NextResponse.json({ success: false, error }, { status });
}

/**
 * Llamar al inicio de cada ruta: regresa una respuesta de error si la
 * petición no está autorizada, o null si puede continuar.
 * `agent`: la ruta también la usa B-POS Agent.
 */
export async function guardBridgeRequest(request: NextRequest, { agent = false } = {}) {
  if (isCrossSite(request)) return deny(403, "Origen no permitido.");

  const key = request.headers.get(AGENT_KEY_HEADER);
  if (key) {
    // Si no coincide se vuelve a leer el archivo: el Agent pudo crearla después
    const ok = agent && (sameKey(key, getAgentKey()) || sameKey(key, getAgentKey(true)));
    return ok ? null : deny(401, "Llave del Agent inválida.");
  }
  getAgentKey(); // en una instalación nueva deja la llave lista para el Agent

  // Sin nube (modo local) no hay cuentas que revisar
  if (!isCloudConfigured) return null;

  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (token) {
    try {
      return (await isBusinessSession(token)) ? null : deny(401, "Sesión no válida para este negocio.");
    } catch {
      return deny(503, "No se pudo verificar la sesión con la nube.");
    }
  }

  // Agent viejo (sin llave): solo entregar pedidos, mientras se reinstala
  const legacyAgent = agent && request.method === "POST" && !request.headers.get("origin") && process.env.BPOS_REQUIRE_AGENT_KEY !== "1";
  if (legacyAgent) {
    getAgentKey(); // deja la llave lista para el Agent nuevo
    console.warn("[B-POS] Pedido del Agent sin llave aceptado. Reinstala B-POS Agent para usar la llave.");
    return null;
  }

  return deny(401, "Inicia sesión en B-POS para usar el Bridge.");
}
