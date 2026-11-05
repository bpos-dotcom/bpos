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
  // DiDi imprime el ticket angosto en una esquina de la hoja carta: se recorta a
  // lo impreso (con margen blanco: Tesseract pierde el "1x" pegado a la orilla)
  // y se agranda a ~1500 px de ancho; con la hoja entera la letra quedaba chica
  const { width, height, gray } = page;
  let top = height, bottom = -1, left = width, right = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (gray[row + x] < 200) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (bottom < 0) return createCanvas(10, 10); // página en blanco
  const pad = 30;
  const cropW = right - left + 1 + pad * 2;
  const cropH = bottom - top + 1 + pad * 2;
  const crop = createCanvas(cropW, cropH);
  const ctx = crop.getContext("2d");
  const img = ctx.createImageData(cropW, cropH);
  img.data.fill(255);
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const v = gray[y * width + x];
      const o = ((y - top + pad) * cropW + (x - left + pad)) * 4;
      img.data[o] = v;
      img.data[o + 1] = v;
      img.data[o + 2] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
  const scale = cropW < 1500 ? Math.min(3, 1500 / cropW) : cropW > 2000 ? 2000 / cropW : 1;
  if (scale === 1) return crop;
  const out = createCanvas(Math.round(cropW * scale), Math.round(cropH * scale));
  const octx = out.getContext("2d");
  octx.imageSmoothingQuality = "high";
  octx.drawImage(crop, 0, 0, out.width, out.height);
  return out;
}

module.exports = { isPwgRaster, decodePwgRaster, pageToCanvas };
