function parseItemsFromSection(itemSection) {
  const matches = [...itemSection.matchAll(/(\d+)x\s+([\s\S]*?)(?=\s+\d+x\s+|$)/gi)];

  return matches.map((match) => {
    const qty = Number(match[1]);
    const block = match[2].replace(/\s+/g, " ").trim();

    const parts = block
      .split(/(?=\s[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+[:?])|(?=\sElige\s)|(?=\sSelecciona\s)|(?=\sNotas?\s)/i)
      .map((part) => part.trim())
      .filter(Boolean);

    const externalName = (parts[0] || "")
      .replace(/MX\$[\d.,]+/gi, "")
      .trim();

    const modifiers = parts
      .slice(1)
      .map((part) => part.replace(/MX\$[\d.,]+/gi, "").trim())
      .filter(Boolean);

    return {
      qty,
      externalName,
      modifiers,
    };
  });
}

function parseDidi(text) {
  const clean = text.replace(/\s+/g, " ").trim();

  // Los productos terminan donde empiezan los cargos (con OCR no siempre viene "Subtotal")
  const itemSectionMatch = clean.match(
    /Notas del pedido\s+(.+?)\s+(?:Subtotal|Dto\. de producto|Tarifa de entrega|Tarifa de servicio|Total a pagar)/i
  );
  const itemSection = itemSectionMatch ? itemSectionMatch[1] : clean;

  return {
    platform: "didi",
    orderId: clean.match(/#\s*(\d+)/)?.[1] || null,
    customer: {
      name: clean.match(/#\s*\d+\s+(.+?)\s+Plataforma/)?.[1]?.trim() || null,
      phone: null,
    },
    delivery: {
      address:
        clean.match(/Dirección\s+(.+?)\s+Notas del pedido/i)?.[1]?.trim() ||
        null,
      type: "delivery",
    },
    items: parseItemsFromSection(itemSection),
    notes:
      clean.match(/Notas del pedido\s+(.+?)\s+\d+x/i)?.[1]?.trim() || null,
    // Con OCR los importes quedan al final, lejos de "Total a pagar": el último MX$ es el total
    total: Number(
      clean.match(/Total a pagar\s+MX\$?\s*([\d.]+)/i)?.[1] ||
        [...clean.matchAll(/MX\$\s*([\d.,]+)/gi)].pop()?.[1]?.replace(/,/g, "") ||
        0
    ),
    createdAt: new Date().toISOString(),
    // Con saltos de línea: B-POS busca los renglones "1x Producto"
    rawText: String(text || ""),
  };
}

module.exports = parseDidi;