function normalizeText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanLine(line) {
  return String(line || "")
    .replace(/^[|"'`´]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractOrderId(lines) {
  const uberIndex = lines.findIndex((line) =>
    /uber\s*eats/i.test(line)
  );

  const isValidOrderId = (value) => {
    const candidate = String(value || "")
      .replace(/[^A-Z0-9]/gi, "")
      .toUpperCase();

    return (
      /^[A-Z0-9]{4,10}$/.test(candidate) &&
      /[A-Z]/.test(candidate) &&
      /\d/.test(candidate) &&
      !candidate.includes("MXN") &&
      !/^\d+$/.test(candidate)
    );
  };

  if (uberIndex !== -1) {
    for (
      let index = uberIndex + 1;
      index <= uberIndex + 5 && index < lines.length;
      index += 1
    ) {
      const candidate = lines[index]
        .replace(/[^A-Z0-9]/gi, "")
        .toUpperCase();

      if (isValidOrderId(candidate)) {
        return candidate;
      }
    }
  }

  for (const line of lines.slice(0, 12)) {
    const candidates =
      line
        .toUpperCase()
        .match(/\b[A-Z0-9]{4,10}\b/g) || [];

    for (const candidate of candidates) {
      if (isValidOrderId(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function extractCustomerName(lines, orderId) {
  const ignoredPatterns = [
    /uber\s*eats/i,
    /entrega/i,
    /domicilio/i,
    /art[ií]culos\s+desechables/i,
    /hora\s+del\s+pedido/i,
    /recolecci[oó]n/i,
    /pickup/i,
  ];

  // En Uber, el cliente normalmente aparece justo después
  // del identificador alfanumérico del pedido.
  if (orderId) {
    const orderIndex = lines.findIndex((line) => {
      const normalizedLine = String(line || "")
        .replace(/[^A-Z0-9]/gi, "")
        .toUpperCase();

      return normalizedLine === String(orderId).toUpperCase();
    });

    if (orderIndex !== -1) {
      for (
        let index = orderIndex + 1;
        index <= orderIndex + 3 && index < lines.length;
        index += 1
      ) {
        const candidate = cleanLine(lines[index]);

        const isIgnored = ignoredPatterns.some((pattern) =>
          pattern.test(candidate)
        );

        const looksLikeName =
          candidate.length >= 2 &&
          candidate.length <= 50 &&
          /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(candidate) &&
          !/\$|MXN|\d{2,}/i.test(candidate);

        if (looksLikeName && !isIgnored) {
          return candidate;
        }
      }
    }
  }

  // Respaldo: busca una línea con apariencia de nombre
  // en las primeras líneas del ticket.
  for (const line of lines.slice(0, 12)) {
    const candidate = cleanLine(line);

    const isIgnored = ignoredPatterns.some((pattern) =>
      pattern.test(candidate)
    );

    const looksLikeName =
      candidate.length >= 2 &&
      candidate.length <= 50 &&
      /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ.' -]+$/.test(candidate);

    if (looksLikeName && !isIgnored) {
      return candidate;
    }
  }

  return null;
}

function extractOrderType(lines) {
  const normalizedLines = lines.map((line) =>
    String(line || "").trim().toLowerCase()
  );

  if (
    normalizedLines.some(
      (line) =>
        line === "entrega" ||
        line.includes("entrega a domicilio")
    )
  ) {
    return "delivery";
  }

  if (
    normalizedLines.some(
      (line) =>
        line.includes("recolección") ||
        line.includes("recoleccion") ||
        line.includes("recoger") ||
        line.includes("pickup")
    )
  ) {
    return "pickup";
  }

  return null;
}

function extractItems(lines) {
  const items = [];
  const totalsStart = lines.findIndex((line) =>
    /total pagado|subtotal|promoci[oó]n|importe pagado/i.test(line)
  );

  const itemArea =
    totalsStart === -1 ? lines : lines.slice(0, totalsStart);

  let currentItem = null;

  for (const line of itemArea) {
    const itemMatch = line.match(
      /^(\d+)\s*[xX]\s+(.+?)(?:\s+(-?\(?\s*\d+(?:[.,]\d{2})?\s*(?:MXN|MX\$)?\)?))?$/
    );

    if (itemMatch) {
      currentItem = {
        qty: Number(itemMatch[1]),
        name: itemMatch[2]
          .replace(/\s+\d+(?:[.,]\d{2})?\s*(?:MXN|MX\$).*$/i, "")
          .trim(),
        modifiers: [],
      };

      items.push(currentItem);
      continue;
    }

    if (
      currentItem &&
      line &&
      !/art[ií]culos desechables|hora del pedido|entrega|uber eats/i.test(line)
    ) {
      currentItem.modifiers.push(line);
    }
  }

  return items;
}

function parseMoney(value) {
  if (!value) return 0;

  const normalized = value
    .replace(/[^\d.,-]/g, "")
    .replace(/,/g, "");

  const number = Number.parseFloat(normalized);
  return Number.isFinite(number) ? number : 0;
}

function extractTotal(lines) {
  const preferredPatterns = [
    /monto\s+pagado/i,
    /importe\s+pagado/i,
    /total\s+pagado\s+por\s+el\s+usuario/i,
  ];

  for (const pattern of preferredPatterns) {
    const line = lines.find((candidate) => pattern.test(candidate));

    if (!line) {
      continue;
    }

    const moneyMatches = line.match(
      /(?:MX\$|\$)?\s*-?\s*\(?\d[\d,]*(?:\.\d{2})?\)?\s*(?:MXN)?/gi
    );

    if (!moneyMatches?.length) {
      continue;
    }

    const lastAmount = moneyMatches[moneyMatches.length - 1];

    const normalized = lastAmount
      .replace(/[^\d.,-]/g, "")
      .replace(/,/g, "");

    const amount = Number.parseFloat(normalized);

    if (Number.isFinite(amount)) {
      return Math.abs(amount);
    }
  }

  return 0;
}

function parseUber(text) {
  const rawText = normalizeText(text);

  const lines = rawText
    .split("\n")
    .map(cleanLine)
    .filter(Boolean);

  const orderId = extractOrderId(lines);

return {
  platform: "uber",
  orderId,
  customer: {
    name: extractCustomerName(lines, orderId),
    phone: null,
  },
  delivery: {
    address: null,
    type: extractOrderType(lines),
  },
  items: extractItems(lines),
  notes: null,
  total: extractTotal(lines),
  createdAt: new Date().toISOString(),
  rawText,
};
}

module.exports = parseUber;