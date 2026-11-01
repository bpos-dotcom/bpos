export type KdsTicketLineKind = "selection" | "prompt" | "context";

export type KdsTicketLine = {
  id: string;
  text: string;
  kind: KdsTicketLineKind;
  quantity?: number;
};

const QUANTITY_LINE = /^\s*\[?\s*(\d{1,4})\s*[xX×]\s*\]?\s*(.+?)\s*$/;

const END_MARKERS = [
  /^subtotal\b/i,
  /^total\b/i,
  /^descuento\b/i,
  /^dto\.?\b/i,
  /^tarifa\b/i,
  /^pago\b/i,
  /^importe\b/i,
  /^monto\b/i,
  /^hora de aceptaci[oó]n\b/i,
  /^resumen de pago\b/i,
  /^oferta\b/i,
  /^fecha de la transacci/i,
  /^gracias por\b/i,
];

function cleanLine(value: unknown) {
  return String(value ?? "").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}

/**
 * Conserva el detalle operativo completo para KDS, pero no altera la regla
 * del Bridge: las equivalencias siguen aplicándose exclusivamente a líneas Nx.
 */
export function extractKdsTicketLines(rawText: string): KdsTicketLine[] {
  const lines = String(rawText || "")
    .replace(/\r/g, "")
    .split("\n")
    .map(cleanLine)
    .filter(Boolean);

  const firstSelection = lines.findIndex((line) => QUANTITY_LINE.test(line));
  if (firstSelection < 0) return [];

  const operational: string[] = [];
  for (let index = firstSelection; index < lines.length; index += 1) {
    const line = lines[index];
    if (END_MARKERS.some((pattern) => pattern.test(line))) break;
    operational.push(line);
  }

  return operational.map((line, index) => {
    const quantityMatch = line.match(QUANTITY_LINE);
    if (quantityMatch) {
      return {
        id: `selection-${index}-${quantityMatch[1]}-${quantityMatch[2]}`,
        text: quantityMatch[2].trim(),
        kind: "selection" as const,
        quantity: Number(quantityMatch[1]),
      };
    }

    const looksLikePrompt = /[?:]$/.test(line) || /^(elige|selecciona|escoge|deseas|quieres|qu[eé] tal|tipo de|sabor|tama[nñ]o|preparaci[oó]n)/i.test(line);

    return {
      id: `${looksLikePrompt ? "prompt" : "context"}-${index}-${line}`,
      text: line,
      kind: looksLikePrompt ? ("prompt" as const) : ("context" as const),
    };
  });
}
