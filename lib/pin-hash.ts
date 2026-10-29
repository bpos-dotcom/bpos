"use client";

/**
 * PIN cifrados (bloque 11).
 *
 * Antes los PIN se guardaban en texto plano en bpos_users y así se
 * sincronizaban a la nube: cualquiera que viera esos datos leía el PIN de
 * todos, incluido el del Admin. Ahora se guarda solo un hash PBKDF2-SHA256
 * con sal aleatoria por usuario. La revisión sigue funcionando sin internet.
 *
 * Formato: "pbkdf2$<iteraciones>$<sal base64>$<hash base64>".
 */
const ITERATIONS = 210_000;

function toB64(bytes: ArrayBuffer | Uint8Array) {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = "";
  array.forEach((b) => (text += String.fromCharCode(b)));
  return btoa(text);
}

function fromB64(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

async function derive(pin: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, 256);
}

export async function hashPin(pin: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

/** Compara en tiempo constante para no revelar cuántos caracteres coinciden. */
function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** ¿El PIN escrito corresponde al usuario? Acepta el PIN viejo en texto mientras se migra. */
export async function verifyPin(pin: string, user: { pin?: string; pinHash?: string }) {
  if (!pin) return false;
  if (user.pinHash) {
    const [scheme, iterations, salt, hash] = user.pinHash.split("$");
    if (scheme !== "pbkdf2" || !salt || !hash) return false;
    const derived = new Uint8Array(await derive(pin, fromB64(salt), Number(iterations) || ITERATIONS));
    return sameBytes(derived, fromB64(hash));
  }
  return typeof user.pin === "string" && user.pin === pin;
}
