/**
 * API segura para /api/bridge/* (B-POS 2.0, en la nube).
 *
 * Solo las pantallas de B-POS con la sesión de la cuenta del negocio pueden
 * usarla (ver lib/bridge/bridge-fetch.ts). La sucursal llega en el
 * encabezado x-bpos-branch; si no llega o no es del negocio se usa la
 * primera. B-POS Agent ya no llama aquí: sube los pedidos directo a la nube
 * con su propia llave (funciones bpos_agent_* en Supabase).
 *
 * Sin nube (NEXT_PUBLIC_BPOS_LOCAL=1, para pruebas) los datos van a disco.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isCloudConfigured, SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/client";

export const BRANCH_HEADER = "x-bpos-branch";
const CACHE_MS = 5 * 60 * 1000;

export type BridgeContext =
  | { mode: "disk" }
  | { mode: "cloud"; db: SupabaseClient; businessId: string; branchId: string };

type Verified = { businessId: string; branchId: string; until: number };
const verified = new Map<string, Verified>(); // token|sucursal → negocio

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

function deny(status: number, error: string) {
  return NextResponse.json({ success: false, error }, { status });
}

/** Negocio y sucursal de la sesión (RLS: solo ve las sucursales de sus negocios). */
async function resolveBranch(db: SupabaseClient, token: string, wanted: string): Promise<Verified | null> {
  const cacheKey = `${token}|${wanted}`;
  const cached = verified.get(cacheKey);
  if (cached && cached.until > Date.now()) return cached;

  const { data: user, error } = await db.auth.getUser(token);
  if (error || !user.user) return null;

  let branch: { id: string; business_id: string } | null = null;
  if (/^[0-9a-f-]{36}$/i.test(wanted)) {
    const { data } = await db.from("branches").select("id, business_id").eq("id", wanted).maybeSingle();
    branch = data;
  }
  if (!branch) {
    const { data: member } = await db
      .from("business_members")
      .select("business_id")
      .eq("user_id", user.user.id)
      .order("created_at", { ascending: true })
      .limit(1);
    const businessId = member?.[0]?.business_id;
    if (!businessId) return null;
    const { data } = await db
      .from("branches")
      .select("id, business_id")
      .eq("business_id", businessId)
      .order("created_at", { ascending: true })
      .limit(1);
    branch = data?.[0] ?? null;
  }
  if (!branch) return null;

  if (verified.size > 500) verified.clear();
  const result = { businessId: branch.business_id, branchId: branch.id, until: Date.now() + CACHE_MS };
  verified.set(cacheKey, result);
  return result;
}

/**
 * Llamar al inicio de cada ruta: regresa { denied } si la petición no está
 * autorizada, o { ctx } con dónde guardar los datos del Bridge.
 */
export async function bridgeAuth(request: NextRequest): Promise<{ denied: NextResponse } | { ctx: BridgeContext }> {
  if (isCrossSite(request)) return { denied: deny(403, "Origen no permitido.") };
  if (!isCloudConfigured) return { ctx: { mode: "disk" } };

  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return { denied: deny(401, "Inicia sesión en B-POS para usar el Bridge.") };

  const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  try {
    const branch = await resolveBranch(db, token, request.headers.get(BRANCH_HEADER) || "");
    if (!branch) return { denied: deny(401, "Sesión no válida para este negocio.") };
    return { ctx: { mode: "cloud", db, businessId: branch.businessId, branchId: branch.branchId } };
  } catch {
    return { denied: deny(503, "No se pudo verificar la sesión con la nube.") };
  }
}
