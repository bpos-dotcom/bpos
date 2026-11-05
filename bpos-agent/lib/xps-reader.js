// Lee los tickets que llegan como XPS. En Windows 11 nuevo no viene el
// controlador "Microsoft Print To PDF" que acepta un puerto de red, y la
// impresora virtual queda con "Microsoft XPS Document Writer v4".
// El XPS es un ZIP; el spooler lo manda en pedazos ("Pages/1.fpage/[0].piece",
// "[1].last.piece") que hay que volver a juntar. El texto viene en los
// <Glyphs UnicodeString="..."> de cada página; si el ticket es una imagen
// (DiDi), se le pasa OCR a las imágenes.
const AdmZip = require("adm-zip");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const { ocrPages } = require("./pdf-ocr-reader");

const PIECE = /^(.*)\/\[(\d+)\](?:\.last)?\.piece$/i;

/** Partes del XPS ya unidas: { "Documents/1/Pages/1.fpage": Buffer, ... } */
function readParts(filePath) {
  const zip = new AdmZip(filePath);
  const pieces = new Map();
  const parts = {};
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.replace(/\\/g, "/");
    const m = name.match(PIECE);
    if (!m) {
      parts[name] = entry.getData();
      continue;
    }
    if (!pieces.has(m[1])) pieces.set(m[1], []);
    pieces.get(m[1]).push({ index: Number(m[2]), data: entry.getData() });
  }
  for (const [name, list] of pieces) {
    parts[name] = Buffer.concat(list.sort((a, b) => a.index - b.index).map((p) => p.data));
  }
  return parts;
}

function cleanXml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
}

/** Texto de las páginas, un renglón por cada altura (OriginY) como en el ticket impreso. */
function pageText(xml) {
  const glyphs = [];
  for (const m of xml.matchAll(/<Glyphs\b([^>]*)>/g)) {
    let text = attr(m[1], "UnicodeString");
    if (!text) continue;
    // "{}" al inicio es un escape de XPS
    if (text.startsWith("{}")) text = text.slice(2);
    glyphs.push({ text: cleanXml(text), x: Number(attr(m[1], "OriginX")) || 0, y: Number(attr(m[1], "OriginY")) || 0 });
  }
  const lines = [];
  for (const g of glyphs) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - g.y) <= 2) last.items.push(g);
    else lines.push({ y: g.y, items: [g] });
  }
  return lines.map((l) => l.items.sort((a, b) => a.x - b.x).map((g) => g.text).join(" ")).join("\n");
}

const pageNumber = (name) => Number((name.match(/(\d+)\.fpage$/i) || [])[1]) || 0;

/**
 * @returns {Promise<{ text: string, method: string, orderId?: string|null, headerText?: string }>}
 */
async function extractXpsTicket(filePath) {
  const parts = readParts(filePath);
  const names = Object.keys(parts);

  const pages = names.filter((n) => /\.fpage$/i.test(n)).sort((a, b) => pageNumber(a) - pageNumber(b));
  const text = pages.map((n) => pageText(parts[n].toString("utf8"))).join("\n").trim();
  // Con renglones de productos ("1x Hamburguesa") el texto basta
  if (/\b\d+\s*x\s/i.test(text)) return { text, method: "xps-texto" };

  // Ticket como imagen: OCR de las imágenes en el orden en que aparecen
  const images = names.filter((n) => /\.(png|jpe?g)$/i.test(n));
  const others = names.filter((n) => /\.(tiff?|wdp|jxr)$/i.test(n));
  if (others.length) console.warn(`XPS con imágenes que no se pueden leer: ${others.join(", ")}`);
  const canvases = [];
  for (const name of images) {
    try {
      const img = await loadImage(parts[name]);
      if (img.width < 150 || img.height < 150) continue;
      // Tesseract lee mejor letras grandes: imágenes chicas se agrandan
      const scale = img.width < 1200 ? 1200 / img.width : 1;
      const canvas = createCanvas(Math.round(img.width * scale), Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvases.push(canvas);
    } catch (error) {
      console.warn(`No se pudo abrir la imagen ${name} del XPS: ${error.message}`);
    }
  }
  if (!canvases.length) return { text, method: "xps-texto" };

  const ocr = await ocrPages(canvases.map((c) => async () => c));
  return {
    text: [text, ocr.text].filter(Boolean).join("\n"),
    method: "tesseract-ocr",
    orderId: ocr.orderId,
    headerText: ocr.headerText,
  };
}

module.exports = { extractXpsTicket, readParts, pageText };
