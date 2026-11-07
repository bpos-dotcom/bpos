/**
 * Estructura del texto del ticket de plataforma: qué renglones "1x ..." son
 * productos y cuáles son sub-líneas (opciones) del producto anterior.
 *
 * Misma regla que el armado del ticket (delivery-ticket.ts): una línea "1x"
 * es opción del producto anterior si viene después de un encabezado de grupo
 * ("Elige tu refresco:" → "1x Coca") o si no trae precio. Una línea "1x" con
 * precio y sin encabezado es un producto nuevo. Sin dependencias del
 * navegador, para poder usarse en el servidor al interpretar.
 */
import { fixOcrQuantity } from "./ocr-quantity";

const QUANTIFIED = /^\s*\[?\s*(\d{1,4})\s*[xX×]\s*\]?\s*(.+?)\s*$/;
// "MX$135.00", "$135", "MXN 160.00" (Uber) y "135,00 MXN" (Uber, sin signo)
const TRAILING_MONEY = /\s*(-?)\s*(?:(?:MX\$|\$|MXN)\s*(\d[\d,]*(?:[.,]\d{1,2})?)\s*(?:MXN)?|(\d[\d,]*(?:[.,]\d{2}))\s*MXN)\s*$/i;
const CHARGE = /^(sub\s*total|total(?:\s+a\s+pagar|\s+pagado)?|dto\.?\s+de\s+producto|descuento[^$]*|promoci[oó]n[^$]*|tarifa\s+de\s+(?:entrega|servicio)|costo\s+de\s+env[ií]o|env[ií]o|propina|cargo[^$]*)\s*[:\-]?\s*-?\s*(?:MX\$|\$|MXN\s*\d)/i;

/** Precio al final del renglón en cualquiera de esos formatos; null si no trae */
export function trailingPrice(line: string): number | null {
  const money = String(line || "").match(TRAILING_MONEY);
  if (!money) return null;
  const digits = money[2] ?? money[3];
  // "160,00" es coma decimal; "1,234.50" es coma de miles
  const amount = /,\d{2}$/.test(digits) ? Number(digits.replace(/\./g, "").replace(",", ".")) : Number(digits.replace(/,/g, ""));
  return money[1] ? -amount : amount;
}
const NOTE = /^(sin|con|extra|poco|mucho|bien|t[eé]rmino|nota|notas|por favor|aparte)\b/i;
const END_OF_ITEMS = /^(pago\s+(?:de|en|con)\b|hora\s+de|m[eé]todo\s+de\s+pago|forma\s+de\s+pago)/i;

/** Renglón de la sub-línea → renglón del producto al que pertenece */
export function ticketLineParents(rawText: string): Map<number, number> {
  const parents = new Map<number, number>();
  let current: number | null = null;
  let question: string | null = null;
  let inCharges = false;

  String(rawText || "")
    .replace(/\r/g, "")
    .split("\n")
    .forEach((raw, index) => {
      const line = raw.trim();
      if (!line || inCharges) return;
      if (current !== null && (CHARGE.test(line) || END_OF_ITEMS.test(line))) {
        inCharges = true;
        return;
      }
      const quantified = fixOcrQuantity(line).match(QUANTIFIED);
      if (quantified) {
        // Igual que el ticket de cocina: $0 también es opción ("1x Mango habanero MX$0.00",
        // segundo aderezo de la misma pregunta), no un producto nuevo
        const price = trailingPrice(quantified[2]) || 0;
        if (current !== null && (question !== null || !price)) {
          parents.set(index, current);
          question = null;
          return;
        }
        current = index;
        question = null;
        return;
      }
      if (current === null) return;
      if (!/[a-záéíóúñ]/i.test(line) || TRAILING_MONEY.test(line) || NOTE.test(line)) return;
      question = line;
    });

  return parents;
}
