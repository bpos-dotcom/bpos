// Ticket de una plataforma que no se reconoce (estaba vacío). Saca lo que
// pueda y lo manda al Bridge como "otro" para revisarlo a mano.
const { toLines, extractItems, extractTotal, extractLabeled, fallbackOrderId } = require("./common");

function parseGeneric(text) {
  const rawText = String(text || "");
  const lines = toLines(rawText);
  const found = rawText.match(/(?:orden|pedido|order|folio|ticket)\s*(?:no\.?|n[uú]m\.?)?\s*[:#]?\s*#?\s*([A-Z0-9-]*\d[A-Z0-9-]*)/i);

  return {
    orderId: found ? found[1] : fallbackOrderId(rawText),
    orderIdDetected: Boolean(found),
    customer: { name: extractLabeled(lines, ["cliente", "nombre"]), phone: extractLabeled(lines, ["tel[eé]fono"]) },
    delivery: { address: extractLabeled(lines, ["direcci[oó]n"]), type: null },
    items: extractItems(lines),
    notes: extractLabeled(lines, ["notas?", "comentarios?"]),
    total: extractTotal(lines),
    createdAt: new Date().toISOString(),
    rawText,
  };
}

module.exports = parseGeneric;
