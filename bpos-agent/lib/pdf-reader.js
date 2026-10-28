const fs = require("fs");

// Arma las líneas del ticket con la posición de cada texto en la página:
// B-POS busca renglones tipo "1x Hamburguesa", así que no basta con unir todo.
function pageLines(items) {
  const rows = [];
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const height = Math.abs(item.height || item.transform[3] || 10);
    let row = rows.find((r) => Math.abs(r.y - y) <= Math.max(2, height * 0.45));
    if (!row) {
      row = { y, parts: [] };
      rows.push(row);
    }
    row.parts.push({ x, text: item.str });
  }
  // En PDF la y crece hacia arriba: primero los renglones de más arriba
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) =>
    r.parts
      .sort((a, b) => a.x - b.x)
      .map((p) => p.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

async function extractPdfText(file) {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const data = new Uint8Array(fs.readFileSync(file));
  const pdfDoc = await pdfjsLib.getDocument({ data }).promise;

  const lines = [];

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    lines.push(...pageLines(textContent.items));
  }

  return lines.filter(Boolean).join("\n").trim();
}

module.exports = {
  extractPdfText,
};
