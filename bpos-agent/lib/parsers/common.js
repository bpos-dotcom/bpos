// Piezas comunes para leer tickets de delivery (Rappi y genérico).
// Devuelven la misma forma que los parsers de Uber y DiDi.
const crypto = require("crypto");

function toLines(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function parseMoney(value) {
  const n = Number.parseFloat(String(value || "").replace(/[^\d.,-]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

const MONEY = /(?:MX\$|\$)\s*-?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*\.\d{2}\s*(?:MXN)?/i;

/** "2x Hamburguesa $240.00", "2 x Hamburguesa", "x2 Hamburguesa"; lo que sigue sin cantidad son modificadores */
function extractItems(lines, { stopAt = /^(sub\s*total|total|propina|env[ií]o|costo de env[ií]o|descuento|m[eé]todo de pago|forma de pago)\b/i } = {}) {
  const items = [];
  let current = null;
  for (const line of lines) {
    if (stopAt.test(line) && items.length) break;
    const m = line.match(/^(\d{1,3})\s*[xX×]\s*(.+)$/) || line.match(/^[xX×]\s*(\d{1,3})\s+(.+)$/);
    if (m) {
      const name = m[2].replace(new RegExp(`\\s*${MONEY.source}\\s*$`, "i"), "").trim();
      if (!name) continue;
      current = { qty: Number(m[1]), name, externalName: name, modifiers: [] };
      items.push(current);
      continue;
    }
    // Renglones sangrados o con "+"/"-" después de un producto: extras y notas
    if (current && /^[+\-•·*]|^(sin|con|extra|agregar|quitar|nota|t[eé]rmino)\b/i.test(line)) {
      current.modifiers.push(line.replace(/^[+\-•·*]\s*/, ""));
    }
  }
  return items;
}

function extractTotal(lines) {
  const preferred = [/total\s+(?:a\s+)?pagar/i, /total\s+pagado/i, /^total\b/i, /\btotal\b/i];
  for (const p of preferred) {
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (!p.test(lines[i]) || /sub\s*total/i.test(lines[i])) continue;
      const amounts = lines[i].match(new RegExp(MONEY.source, "gi")) || (lines[i + 1] || "").match(new RegExp(MONEY.source, "gi"));
      if (amounts?.length) return parseMoney(amounts[amounts.length - 1]);
    }
  }
  return 0;
}

function extractLabeled(lines, labels) {
  for (let i = 0; i < lines.length; i += 1) {
    for (const label of labels) {
      const m = lines[i].match(new RegExp(`^${label}\\s*[:#]?\\s*(.+)$`, "i"));
      if (m && m[1].trim()) return m[1].trim();
      if (new RegExp(`^${label}\\s*:?$`, "i").test(lines[i]) && lines[i + 1]) return lines[i + 1];
    }
  }
  return null;
}

/** Id estable cuando el ticket no trae número: el mismo ticket impreso dos veces da el mismo id (B-POS lo marca duplicado). */
function fallbackOrderId(text) {
  return `SINID-${crypto.createHash("sha1").update(String(text || "")).digest("hex").slice(0, 8).toUpperCase()}`;
}

module.exports = { toLines, parseMoney, extractItems, extractTotal, extractLabeled, fallbackOrderId };
