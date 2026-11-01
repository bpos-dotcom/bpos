import type { NextRequest } from "next/server";
import { aiPreflight, aiReply } from "@/lib/ai/cloud";
import { supabaseAdmin } from "@/lib/billing/mercadopago";
import { KioskError, listKioskAgents, listKiosks, newKioskAgentCode, newKioskCode, revokeKiosk, unlinkKioskAgent, updateKiosk } from "@/lib/kiosk/server";
import { listTerminals, memberSession, merchantToken } from "@/lib/mp/merchant";

/**
 * Pantallas de kiosco de la sucursal (Configuración → Menú digital, con la
 * sesión del negocio).
 *   GET    ?branch=<id>                       pantallas, Agents de la sucursal, terminales de la cuenta y la de caja
 *   POST   { branchId }                       código de 6 dígitos para vincular una pantalla
 *   POST   { kioskId }                        código de 8 letras para vincular el B-POS Agent de esa pantalla
 *   PATCH  { id, name?, terminalId?, printer?, paperMm? }   nombre, terminal e impresora de la pantalla
 *   DELETE ?id=<pantalla>                     desvincular la pantalla (y su Agent)
 *   DELETE ?agentOf=<pantalla>                desvincular solo el Agent de la pantalla
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(request: NextRequest) {
  return aiPreflight(request);
}

const fail = (request: NextRequest, error: unknown) =>
  error instanceof KioskError
    ? aiReply(request, { success: false, error: error.message }, error.status)
    : aiReply(request, { success: false, error: error instanceof Error ? error.message : "No se pudo." }, 502);

export async function GET(request: NextRequest) {
  const session = await memberSession(request);
  if ("error" in session) return session.error;
  const branch = request.nextUrl.searchParams.get("branch") || "";
  if (!session.branchIds.includes(branch)) return aiReply(request, { success: false, error: "Sucursal no encontrada." }, 404);
  try {
    const [kiosks, agents, token] = await Promise.all([listKiosks(session.businessId, branch), listKioskAgents(branch), merchantToken(session.businessId).catch(() => null)]);
    const terminals = token ? await listTerminals(token).catch(() => []) : [];
    const { data: pos } = await supabaseAdmin().from("bpos_mp_terminals").select("terminal_id").eq("branch_id", branch).maybeSingle();
    return aiReply(request, { success: true, kiosks, agents, terminals, mpLinked: Boolean(token), posTerminal: pos?.terminal_id || null });
  } catch (error) {
    return fail(request, error);
  }
}

export async function POST(request: NextRequest) {
  const session = await memberSession(request);
  if ("error" in session) return session.error;
  const body = await request.json().catch(() => ({}));
  try {
    if (body?.kioskId) return aiReply(request, { success: true, ...(await newKioskAgentCode(session.businessId, String(body.kioskId), session.userId)) });
    const branchId = String(body?.branchId || "");
    if (!session.branchIds.includes(branchId)) return aiReply(request, { success: false, error: "Sucursal no encontrada." }, 404);
    return aiReply(request, { success: true, ...(await newKioskCode(session.businessId, branchId, session.userId)) });
  } catch (error) {
    return fail(request, error);
  }
}

export async function PATCH(request: NextRequest) {
  const session = await memberSession(request);
  if ("error" in session) return session.error;
  const body = await request.json().catch(() => ({}));
  const id = String(body?.id || "");
  if (!id) return aiReply(request, { success: false, error: "Falta la pantalla." }, 400);
  try {
    await updateKiosk(session.businessId, id, {
      ...(body?.name !== undefined ? { name: String(body.name) } : {}),
      ...(body?.terminalId !== undefined ? { terminalId: String(body.terminalId) } : {}),
      ...(body?.printer !== undefined ? { printer: String(body.printer) } : {}),
      ...(body?.paperMm !== undefined ? { paperMm: Number(body.paperMm) } : {}),
    });
    return aiReply(request, { success: true });
  } catch (error) {
    return fail(request, error);
  }
}

export async function DELETE(request: NextRequest) {
  const session = await memberSession(request);
  if ("error" in session) return session.error;
  const agentOf = request.nextUrl.searchParams.get("agentOf") || "";
  const id = request.nextUrl.searchParams.get("id") || "";
  if (!id && !agentOf) return aiReply(request, { success: false, error: "Falta la pantalla." }, 400);
  try {
    if (agentOf) await unlinkKioskAgent(session.businessId, agentOf);
    else await revokeKiosk(session.businessId, id);
    return aiReply(request, { success: true });
  } catch (error) {
    return fail(request, error);
  }
}
