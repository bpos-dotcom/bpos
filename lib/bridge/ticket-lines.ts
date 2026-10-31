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
const QUANTIFIED = /^\s*(\d{1,4})\s*[xX×]\s*(.+?)\s*$/;
const TRAILING_MONEY = /\s*(-?)\s*(?:MX\$|\$)\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(?:MXN)?\s*$/i;
const CHARGE = /^(sub\s*total|total(?:\s+a\s+pagar|\s+pagado)?|dto\.?\s+de\s+producto|descuento[^$]*|promoci[oó]n[^$]*|tarifa\s+de\s+(?:entrega|servicio)|costo\s+de\s+env[ií]o|env[ií]o|propina|cargo[^$]*)\s*[:\-]?\s*-?\s*(?:MX\$|\$)/i;
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
      const quantified = line.match(QUANTIFIED);
      if (quantified) {
        const hasPrice = TRAILING_MONEY.test(quantified[2]);
        if (current !== null && (question !== null || !hasPrice)) {
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
