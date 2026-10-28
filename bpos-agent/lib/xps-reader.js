const AdmZip = require("adm-zip");
const fs = require("fs");

function cleanXmlText(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function getPieceIndex(name) {
  const match = name.match(/\[(\d+)\]/);
  return match ? Number(match[1]) : 0;
}

async function extractXpsText(filePath) {
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries();

  const pagePieces = entries
    .filter((entry) => {
      const name = entry.entryName.toLowerCase();
      return name.includes(".fpage/") && name.includes(".piece");
    })
    .sort((a, b) => getPieceIndex(a.entryName) - getPieceIndex(b.entryName));

  const pageBuffer = Buffer.concat(pagePieces.map((entry) => entry.getData()));
  const xml = pageBuffer.toString("utf8");
  fs.writeFileSync("pagina-completa.xml", xml, "utf8");

  fs.writeFileSync("pagina-debug.xml", xml, "utf8");

  const matches = [...xml.matchAll(/UnicodeString="([^"]*)"/g)];

  let fullText = "";

  for (const match of matches) {
    fullText += cleanXmlText(match[1]) + " ";
  }

  console.log("Piezas XPS encontradas:", pagePieces.length);
  console.log("UnicodeString encontrados:", matches.length);
  console.log("Texto extraído:", fullText);

  return fullText.replace(/\s+/g, " ").trim();
}

module.exports = {
  extractXpsText,
};