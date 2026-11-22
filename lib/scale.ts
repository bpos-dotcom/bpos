/**
 * Báscula en la caja de tienda o ferretería, de dos formas:
 *
 * 1. Por cable (USB o serial): en el cobro de un artículo a granel, el botón
 *    "⚖️ Pesar" lee el peso de la báscula (Chrome o Edge en la computadora,
 *    con Web Serial). Muchas básculas mandan el peso al recibir una letra
 *    (Torrey: "P"); otras lo mandan solas todo el tiempo (comando vacío).
 * 2. Etiquetas: la báscula imprime una etiqueta con código de barras que
 *    empieza con 2 (2 + 1 dígito + código del artículo + peso o importe +
 *    dígito de control). Al escanearla, el artículo entra con su peso.
 *
 * Se guarda por sucursal en "bpos_scale" (se sincroniza a las cajas de la
 * sucursal). Nada pasa por internet: la báscula habla solo con el equipo.
 */
import type { Product } from "@/data/products";
import { validCheckDigit } from "@/lib/barcode-camera";

export type ScaleSettings = {
  /** Báscula por cable */
  serialEnabled: boolean;
  baudRate: number;
  /** Lo que se le manda para que conteste el peso ("" = la báscula lo manda sola) */
  command: string;
  /** Etiquetas con código de barras de la báscula */
  labelsEnabled: boolean;
  /** Lo que trae la etiqueta: el peso (gramos) o el importe (centavos) */
  labelValue: "peso" | "importe";
  /** Cuántos dígitos del código son el artículo (PLU) */
  pluDigits: 4 | 5 | 6;
};

export const SCALE_KEY = "bpos_scale";
export const SCALE_EVENT = "bpos:scale-updated";
export const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];

export const DEFAULT_SCALE: ScaleSettings = { serialEnabled: false, baudRate: 9600, command: "P", labelsEnabled: false, labelValue: "peso", pluDigits: 5 };

export function normalizeScale(raw: Partial<ScaleSettings> | null | undefined): ScaleSettings {
  const r = raw || {};
  return {
    serialEnabled: r.serialEnabled === true,
    baudRate: BAUD_RATES.includes(Number(r.baudRate)) ? Number(r.baudRate) : DEFAULT_SCALE.baudRate,
    command: typeof r.command === "string" ? r.command.slice(0, 20) : DEFAULT_SCALE.command,
    labelsEnabled: r.labelsEnabled === true,
    labelValue: r.labelValue === "importe" ? "importe" : "peso",
    pluDigits: r.pluDigits === 4 || r.pluDigits === 6 ? r.pluDigits : 5,
  };
}

export function getScaleSettings(): ScaleSettings {
  if (typeof window === "undefined") return DEFAULT_SCALE;
  try {
    return normalizeScale(JSON.parse(localStorage.getItem(SCALE_KEY) || "null"));
  } catch {
    return DEFAULT_SCALE;
  }
}

export function saveScaleSettings(next: Partial<ScaleSettings>) {
  const merged = normalizeScale({ ...getScaleSettings(), ...next });
  localStorage.setItem(SCALE_KEY, JSON.stringify(merged));
  window.dispatchEvent(new Event(SCALE_EVENT));
  return merged;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * El peso que mandó la báscula, en kg. Entiende "  0.250kg", "ST,GS,+  1.235 kg",
 * "250 g", "0.55 lb" o solo el número (en kg). null si no trae número.
 */
export function parseScaleWeight(text: string): number | null {
  const matches = [...String(text || "").matchAll(/([-+]?\s*\d+(?:[.,]\d+)?)\s*(kg|g|lb|oz)?/gi)];
  // La última lectura completa (la báscula puede mandar varias seguidas)
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    const value = Number(m[1].replace(/\s+/g, "").replace(",", "."));
    if (!Number.isFinite(value)) continue;
    const unit = (m[2] || "kg").toLowerCase();
    const kg = unit === "g" ? value / 1000 : unit === "lb" ? value * 0.45359237 : unit === "oz" ? value * 0.028349523 : value;
    return round3(Math.max(0, kg));
  }
  return null;
}

/** Kg leídos → cantidad en la unidad del artículo (kg o g). null si el artículo no se vende por peso */
export function weightToUnit(kg: number, unit: string | undefined) {
  if (unit === "kg") return round3(kg);
  if (unit === "g") return Math.round(kg * 1000);
  return null;
}

export type ScaleLabel = { plu: string; kind: "peso" | "importe"; /** kg o pesos */ value: number };

/** Etiqueta de la báscula (EAN-13 que empieza con 2), o null si no es una */
export function parseScaleLabel(code: string, settings: Pick<ScaleSettings, "labelValue" | "pluDigits">): ScaleLabel | null {
  const c = String(code || "").replace(/\s+/g, "");
  if (!/^2\d{12}$/.test(c) || !validCheckDigit(c)) return null;
  const plu = c.slice(2, 2 + settings.pluDigits);
  const raw = Number(c.slice(2 + settings.pluDigits, 12));
  if (!Number(plu) || !Number.isFinite(raw) || raw <= 0) return null;
  return settings.labelValue === "importe" ? { plu, kind: "importe", value: raw / 100 } : { plu, kind: "peso", value: raw / 1000 };
}

/** El artículo de ese PLU: uno de sus códigos es ese número (con o sin ceros a la izquierda) */
export function findByPlu<T extends Pick<Product, "barcode" | "extraBarcodes">>(products: T[], plu: string): T | undefined {
  const n = Number(plu);
  if (!n) return undefined;
  return products.find((p) => [p.barcode, ...(p.extraBarcodes || [])].some((c) => /^\d{1,6}$/.test(String(c || "").trim()) && Number(c) === n));
}

/** Cantidad y precio del renglón para una etiqueta: por peso (en la unidad del artículo) o por importe */
export function labelLine(product: Pick<Product, "price" | "unit">, label: ScaleLabel): { quantity: number; price: number } | null {
  const price = Number(product.price) || 0;
  if (label.kind === "importe") {
    if (price <= 0) return null;
    return { quantity: round3(label.value / price), price };
  }
  const quantity = product.unit === "g" ? Math.round(label.value * 1000) : round3(label.value);
  return quantity > 0 ? { quantity, price } : null;
}

// ------------------------------------------------------------ báscula por cable (Web Serial)

type SerialPortLike = {
  open: (o: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
};
type SerialLike = { getPorts: () => Promise<SerialPortLike[]>; requestPort: () => Promise<SerialPortLike> };

const serialApi = () => (typeof navigator !== "undefined" ? (navigator as unknown as { serial?: SerialLike }).serial : undefined);

/** ¿Este navegador puede hablar con una báscula por cable? */
export const serialSupported = () => Boolean(serialApi());

/** "P", "\r" escrito como texto → los caracteres de verdad */
const unescape = (s: string) => s.replace(/\\r/g, "\r").replace(/\\n/g, "\n");

/**
 * Lee el peso de la báscula por cable (kg). La primera vez el navegador
 * pregunta qué puerto es; después lo recuerda. Hay que llamarlo desde un clic.
 */
export async function readSerialWeight(settings: Pick<ScaleSettings, "baudRate" | "command"> = getScaleSettings(), timeoutMs = 2500): Promise<number> {
  const serial = serialApi();
  if (!serial) throw new Error("Este navegador no puede leer la báscula por cable. Abre B-POS en Chrome o Edge en la computadora.");
  let port = (await serial.getPorts())[0];
  if (!port) {
    try {
      port = await serial.requestPort();
    } catch {
      throw new Error("No elegiste el puerto de la báscula.");
    }
  }
  try {
    await port.open({ baudRate: settings.baudRate });
  } catch (e) {
    // Ya estaba abierto (otra lectura) está bien; otro error, no
    if ((e as { name?: string }).name !== "InvalidStateError") throw new Error("No se pudo abrir la báscula. Revisa el cable y que ningún otro programa la esté usando.");
  }
  const reader = port.readable?.getReader();
  if (!reader) throw new Error("La báscula no responde.");
  let text = "";
  try {
    if (settings.command && port.writable) {
      const writer = port.writable.getWriter();
      await writer.write(new TextEncoder().encode(unescape(settings.command)));
      writer.releaseLock();
    }
    const decoder = new TextDecoder();
    const until = Date.now() + timeoutMs;
    let found: number | null = null;
    while (Date.now() < until) {
      const left = until - Date.now();
      const chunk = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), left))]);
      if (!chunk || chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
      // Una línea completa con número: listo
      if (/[\r\n]/.test(text)) {
        found = parseScaleWeight(text);
        if (found !== null) break;
      }
    }
    if (found === null) found = parseScaleWeight(text);
    if (found === null) throw new Error("La báscula no mandó el peso. Revisa la velocidad y el comando en Configuración → Sistema → Báscula.");
    return found;
  } finally {
    try {
      await reader.cancel();
    } catch {}
    reader.releaseLock();
    try {
      await port.close();
    } catch {}
  }
}
