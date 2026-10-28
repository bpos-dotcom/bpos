const fs = require("fs");

async function extractPdfText(file) {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const data = new Uint8Array(fs.readFileSync(file));
  const pdfDoc = await pdfjsLib.getDocument({ data }).promise;

  let fullText = "";

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();

    const pageText = textContent.items.map((item) => item.str).join(" ");

    fullText += pageText + "\n";
  }

  return fullText.trim();
}

module.exports = {
  extractPdfText,
};