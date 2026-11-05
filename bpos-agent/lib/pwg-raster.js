// Lee tickets en "PWG Raster" (controlador "Microsoft PWG Raster Class Driver").
// En Windows 11 nuevo no está el controlador PDF que acepta un puerto de red y
// el XPS trae las letras como dibujos vectoriales; con PWG Raster Windows
// entrega cada página ya dibujada como imagen, y se le pasa OCR (Tesseract,
// local y gratis) igual que a un PDF.
//
// Formato (PWG 5102.4): "RaS2" y por cada página un encabezado de 1796 bytes
// y la imagen comprimida por renglones.
const { createCanvas } = require("@napi-rs/canvas");

const HEADER = 1796;

function isPwgRaster(buffer) {
  return buffer.length > 4 + HEADER && buffer.toString("latin1", 0, 4) === "RaS2";
}

/** Páginas como { width, height, gray: Uint8Array } (0 = negro, 255 = blanco). */
function decodePwgRaster(buffer) {
  const pages = [];
  let pos = 4;
  while (pos + HEADER <= buffer.length) {
    const h = buffer.subarray(pos, pos + HEADER);
    pos += HEADER;
    const width = h.readUInt32BE(372);
    const height = h.readUInt32BE(376);
    const bitsPerColor = h.readUInt32BE(384);
    const bitsPerPixel = h.readUInt32BE(388);
    const colorSpace = h.readUInt32BE(400);
    if (!width || !height || bitsPerColor !== 8 || bitsPerPixel % 8) {
      throw new Error(`PWG Raster no soportado (${width}x${height}, ${bitsPerColor}/${bitsPerPixel} bits)`);
    }
    const bpp = bitsPerPixel / 8;
    // 3 = negro (0 = blanco); 18 = gris; 19/20 = RGB
    const toGray = (p) => {
      if (bpp === 1) return colorSpace === 3 ? 255 - buffer[p] : buffer[p];
      return Math.round(buffer[p] * 0.299 + buffer[p + 1] * 0.587 + buffer[p + 2] * 0.114);
    };
    const gray = new Uint8Array(width * height);
    let y = 0;
    while (y < height && pos < buffer.length) {
      const repeat = buffer[pos++] + 1;
      const line = new Uint8Array(width);
      let x = 0;
      while (x < width && pos < buffer.length) {
        const c = buffer[pos++];
        if (c <= 127) {
          // El siguiente pixel se repite c + 1 veces
          const v = toGray(pos);
          pos += bpp;
          for (let i = 0; i <= c && x < width; i++) line[x++] = v;
        } else {
          // 257 - c pixeles tal cual
          for (let i = 0; i < 257 - c && x < width; i++) {
            line[x++] = toGray(pos);
            pos += bpp;
          }
        }
      }
      for (let r = 0; r < repeat && y < height; r++, y++) gray.set(line, y * width);
    }
    pages.push({ width, height, gray });
  }
  return pages;
}

/** Recorta el blanco de abajo (el ticket ocupa una parte de la hoja) y lo pasa a canvas para el OCR. */
function pageToCanvas(page) {
  let bottom = page.height - 1;
  const rowHasInk = (y) => {
    const row = page.gray.subarray(y * page.width, (y + 1) * page.width);
    for (let i = 0; i < row.length; i++) if (row[i] < 200) return true;
    return false;
  };
  while (bottom > 0 && !rowHasInk(bottom)) bottom--;
  const height = Math.min(page.height, bottom + 40);
  // Tesseract no necesita más de ~2000 pixeles de ancho
  const scale = page.width > 2000 ? 2000 / page.width : 1;
  const full = createCanvas(page.width, height);
  const ctx = full.getContext("2d");
  const img = ctx.createImageData(page.width, height);
  for (let i = 0; i < page.width * height; i++) {
    const v = page.gray[i];
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  if (scale === 1) return full;
  const out = createCanvas(Math.round(page.width * scale), Math.round(height * scale));
  out.getContext("2d").drawImage(full, 0, 0, out.width, out.height);
  return out;
}

module.exports = { isPwgRaster, decodePwgRaster, pageToCanvas };
