// Ticket de Rappi (estaba vacío: los pedidos de Rappi tiraban el Agent).
// Formato tolerante: número de orden con "Orden/Pedido/ID #", productos
// "1x Nombre $precio" y total. Si el ticket real trae otro formato, ajustar aquí.
const { toLines, extractItems, extractTotal, extractLabeled, fallbackOrderId } = require("./common");

function extractRappiOrderId(lines, text) {
  const patterns = [
    /(?:orden|pedido|order|id(?:\s+de)?\s+(?:la\s+)?(?:orden|pedido))\s*(?:n[uú]m(?:ero)?\.?|no\.?)?\s*[:#]?\s*#?\s*([A-Z0-9-]{4,})/i,
    /#\s*([0-9]{5,})/,
  ];
  for (const line of lines) {
    for (const p of patterns) {
      const m = line.match(p);
      if (m && /\d/.test(m[1])) return m[1].replace(/-+$/, "");
    }
  }
  // Rappi usa números largos: el primero de 8+ dígitos que no sea teléfono
  const long = String(text).match(/\b(\d{8,12})\b/);
  return long ? long[1] : null;
}

function parseRappi(text) {
  const rawText = String(text || "");
  const lines = toLines(rawText);
  const orderId = extractRappiOrderId(lines, rawText);
  const address = extractLabeled(lines, ["direcci[oó]n", "direcci[oó]n de entrega", "entregar en"]);

  return {
    platform: "rappi",
    orderId: orderId || fallbackOrderId(rawText),
    orderIdDetected: Boolean(orderId),
    customer: {
      name: extractLabeled(lines, ["cliente", "nombre", "usuario"]),
      phone: extractLabeled(lines, ["tel[eé]fono", "tel\\."]),
    },
    delivery: {
      address,
      type: /recoger|pick\s*up|para llevar/i.test(rawText) ? "pickup" : "delivery",
    },
    items: extractItems(lines),
    notes: extractLabeled(lines, ["notas?", "comentarios?", "instrucciones"]),
    total: extractTotal(lines),
    createdAt: new Date().toISOString(),
    rawText,
  };
}

module.exports = parseRappi;
