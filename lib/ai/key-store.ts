/**
 * Llave de Anthropic (Claude) para las funciones con IA.
 *
 * Se guarda solo en la computadora de la caja, en ~/.bpos/anthropic-key
 * (junto a la llave del Agent). No se sincroniza, no entra en los respaldos
 * y nunca va a GitHub. Si existe ANTHROPIC_API_KEY en el servidor, gana esa.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const KEY_FILE = path.join(os.homedir(), ".bpos", "anthropic-key");

/** Modelo para leer menús (el más capaz de la línea Opus). */
export const AI_MODEL = "claude-opus-5-5";

export function readAnthropicKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY.trim();
  try {
    return fs.readFileSync(KEY_FILE, "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function saveAnthropicKey(key: string) {
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, key.trim(), { encoding: "utf8", mode: 0o600 });
}

export function deleteAnthropicKey() {
  try {
    fs.unlinkSync(KEY_FILE);
  } catch {
    // ya no estaba
  }
}

/** Últimos 4 caracteres, para mostrar cuál llave está puesta sin enseñarla. */
export function keyHint(key: string | null) {
  return key ? `…${key.slice(-4)}` : null;
}

export function anthropicClient(key: string) {
  return new Anthropic({ apiKey: key, maxRetries: 2, timeout: 5 * 60 * 1000 });
}

/** Traduce los errores de la API a mensajes para el usuario. */
export function friendlyAiError(error: unknown) {
  if (error instanceof Anthropic.AuthenticationError) return "La llave no es válida. Revisa que la copiaste completa.";
  if (error instanceof Anthropic.PermissionDeniedError) return "La llave no tiene permiso para usar Claude.";
  if (error instanceof Anthropic.RateLimitError) return "Demasiadas solicitudes seguidas. Espera un minuto y vuelve a intentar.";
  if (error instanceof Anthropic.BadRequestError) {
    if (/credit|balance|billing/i.test(error.message)) return "Tu cuenta de Anthropic no tiene saldo. Carga crédito en console.anthropic.com → Billing.";
    return `Claude no aceptó el archivo: ${error.message}`;
  }
  if (error instanceof Anthropic.APIConnectionError) return "Sin conexión con Claude. Revisa el internet de la caja.";
  if (error instanceof Anthropic.APIError) return `Error de Claude (${error.status}): ${error.message}`;
  return error instanceof Error ? error.message : "Error desconocido con la IA.";
}
