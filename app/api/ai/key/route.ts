import { NextResponse, type NextRequest } from "next/server";
import { guardBridgeRequest } from "@/lib/bridge/api-guard";
import { AI_MODEL, anthropicClient, deleteAnthropicKey, friendlyAiError, keyHint, readAnthropicKey, saveAnthropicKey } from "@/lib/ai/key-store";

/**
 * Llave de Anthropic de esta caja (Configuración → Subir menú con IA).
 *   GET     ¿hay llave? (solo los últimos 4 caracteres)
 *   POST    { key }  la prueba con Claude y, si sirve, la guarda
 *   DELETE  la quita
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await guardBridgeRequest(request);
  if (denied) return denied;
  const key = readAnthropicKey();
  return NextResponse.json({ success: true, configured: Boolean(key), hint: keyHint(key) });
}

export async function POST(request: NextRequest) {
  const denied = await guardBridgeRequest(request);
  if (denied) return denied;

  let key = "";
  try {
    key = String((await request.json())?.key || "").trim();
  } catch {
    // sin cuerpo
  }
  if (!key) key = readAnthropicKey() || ""; // sin llave nueva: probar la guardada
  if (!/^sk-ant-[\w-]{20,}$/.test(key)) {
    return NextResponse.json({ success: false, error: "Eso no parece una llave de Anthropic (empieza con sk-ant-)." }, { status: 400 });
  }

  // Probar antes de guardar: consultar el modelo no gasta saldo
  try {
    await anthropicClient(key).models.retrieve(AI_MODEL);
  } catch (error) {
    return NextResponse.json({ success: false, error: friendlyAiError(error) }, { status: 400 });
  }

  try {
    if (key !== readAnthropicKey()) saveAnthropicKey(key);
  } catch {
    return NextResponse.json(
      { success: false, error: "No se pudo guardar la llave aquí. Hazlo desde la computadora de la caja (B-POS instalado)." },
      { status: 500 }
    );
  }
  return NextResponse.json({ success: true, configured: true, hint: keyHint(key) });
}

export async function DELETE(request: NextRequest) {
  const denied = await guardBridgeRequest(request);
  if (denied) return denied;
  deleteAnthropicKey();
  return NextResponse.json({ success: true, configured: Boolean(readAnthropicKey()), hint: keyHint(readAnthropicKey()) });
}
