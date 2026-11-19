"use client";
/**
 * Códigos de barras de los productos (tiendas y ferreterías).
 *   lookupBarcode(code)            busca el producto en Open Food Facts (vía /api/codigo-barras)
 *   isValidEan(code)               dígito de control de EAN-8 / UPC-A / EAN-13 / GTIN-14
 *   normalizeBarcode(raw)          quita espacios
 *   generateInternalBarcode(list)  EAN-13 "20…" (uso interno de la tienda) que no esté repetido
 */

export type BarcodeInfo = {
  name?: string;
  brand?: string;
  image?: string;
  category?: string;
};

/** Busca el código en el catálogo público; null si no se encontró o no hubo internet */
export async function lookupBarcode(code: string, timeoutMs = 7000): Promise<BarcodeInfo | null> {
  const clean = normalizeBarcode(code);
  if (!/^\d{8,14}$/.test(clean)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`/api/codigo-barras?code=${clean}`, { signal: controller.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { found?: boolean } & BarcodeInfo;
    if (!data.found) return null;
    return { name: data.name, brand: data.brand, image: data.image, category: data.category };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Quita espacios (y tabuladores o saltos de línea del lector) */
export function normalizeBarcode(raw: string): string {
  return String(raw ?? "").replace(/\s+/g, "");
}

/** Dígito de control GS1 para los dígitos sin el de control */
export function eanCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    // De derecha a izquierda: 3, 1, 3, 1...
    const weight = (body.length - i) % 2 === 1 ? 3 : 1;
    sum += Number(body[i]) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

/** EAN-8, UPC-A (12), EAN-13 o GTIN-14 con el dígito de control correcto */
export function isValidEan(code: string): boolean {
  const c = normalizeBarcode(code);
  if (!/^(\d{8}|\d{12,14})$/.test(c)) return false;
  return eanCheckDigit(c.slice(0, -1)) === Number(c[c.length - 1]);
}

/**
 * EAN-13 para productos sin código (a granel, hechos en la tienda):
 * empieza con "20" (rango de uso interno) y sigue al más alto que ya existe.
 */
export function generateInternalBarcode(existing: string[]): string {
  const used = new Set(existing.map(normalizeBarcode));
  let next = 1;
  for (const code of used) {
    if (/^20\d{11}$/.test(code)) next = Math.max(next, Number(code.slice(2, 12)) + 1);
  }
  for (let n = next; ; n++) {
    const body = `20${String(n % 1e10).padStart(10, "0")}`;
    const code = body + eanCheckDigit(body);
    if (!used.has(code)) return code;
  }
}
