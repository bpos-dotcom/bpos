/**
 * Celular como escáner: para la caja o computadora sin cámara.
 *
 * La caja muestra un QR con una dirección secreta (/escaner#<llave>). El
 * celular la abre, usa su cámara y manda cada código leído por un canal de
 * tiempo real que solo conocen esa caja y ese celular (la llave son 24
 * letras al azar: nadie más la puede adivinar). Solo viaja el texto del
 * código, nunca la imagen: casi no gasta internet.
 *
 * La llave se guarda en este equipo, así el celular queda ligado: la
 * próxima vez que se abra el escáner ya no hay que volver a leer el QR.
 * "Cambiar celular" crea una llave nueva y el anterior deja de servir.
 */

export const PHONE_SCAN_KEY = "bpos_phone_scanner"; // solo de este dispositivo (ver DEVICE_LOCAL_KEYS)
const TOKEN_RE = /^[A-Za-z0-9_-]{24}$/;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Mensajes del canal */
export type PhoneScanMsg =
  | { event: "hola" } // el celular se conectó (o la caja pregunta si hay alguien)
  | { event: "codigo"; payload: { code: string; id: string } } // celular → caja
  | { event: "recibido"; payload: { id: string; ok: boolean; text: string } } // caja → celular
  | { event: "listo"; payload: { prompt: string } } // la caja abrió el escáner y espera
  | { event: "cerrado" }; // la caja cerró el escáner (ya no espera códigos)

/** Llave nueva al azar (24 letras de 64 posibles = 144 bits) */
export function newScanToken(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  return Array.from(random(24), (b) => ALPHABET[b % 64]).join("");
}

export function validScanToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

/** Canal de tiempo real de esa llave */
export function scanChannel(token: string) {
  return `escaner-${token}`;
}

/** Dirección que abre el celular (la llave va después de #: no llega a ningún servidor ni registro) */
export function scannerUrl(origin: string, token: string) {
  return `${origin.replace(/\/$/, "")}/escaner#${token}`;
}

/** La llave que viene en la dirección del celular */
export function tokenFromHash(hash: string) {
  const token = hash.replace(/^#/, "").trim();
  return validScanToken(token) ? token : "";
}

/** Llave ligada a este equipo (la crea si no hay o si se pide otra) */
export function deviceScanToken(store: Pick<Storage, "getItem" | "setItem"> | null, renew = false) {
  try {
    const saved = store?.getItem(PHONE_SCAN_KEY) ?? "";
    if (!renew && validScanToken(saved)) return saved;
    const token = newScanToken();
    store?.setItem(PHONE_SCAN_KEY, token);
    return token;
  } catch {
    return newScanToken();
  }
}

/** Identificador corto de cada lectura (para que el celular sepa cuál se recibió) */
export function scanId(now = Date.now()) {
  return `${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * La caja recibe un código: no lo usa dos veces si llega repetido (el
 * celular reintenta si no le contestan) y lo limpia como la cámara.
 */
export function acceptPhoneCode(seen: Set<string>, msg: { code?: unknown; id?: unknown }, clean: (raw: unknown) => string) {
  const id = String(msg.id ?? "");
  if (!id || id.length > 40) return { use: false as const, id, reason: "sin-id" };
  if (seen.has(id)) return { use: false as const, id, reason: "repetido" };
  const code = clean(msg.code);
  if (!code) return { use: false as const, id, reason: "no-valido" };
  seen.add(id);
  return { use: true as const, id, code };
}
