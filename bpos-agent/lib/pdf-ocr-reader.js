const fs = require("fs");
const path = require("path");
const os = require("os");
const { createCanvas } = require("@napi-rs/canvas");
const { createWorker } = require("tesseract.js");

let workerPromise = null;

/**
 * Idiomas de Tesseract incluidos en el instalador (resources/tessdata), para
 * que el OCR funcione sin internet. Sin esto tesseract.js los bajaba de un
 * CDN la primera vez y, instalado en Archivos de programa, no podía
 * guardarlos: los volvía a bajar en cada arranque.
 */
function tessdataDir() {
  const packaged = process.resourcesPath && path.join(process.resourcesPath, "tessdata");
  if (packaged && fs.existsSync(path.join(packaged, "spa.traineddata"))) return packaged;
  return path.join(__dirname, "..", "tessdata");
}

async function getOcrWorker() {
  if (!workerPromise) {
    workerPromise = createWorker(["spa", "eng"], 1, {
      langPath: tessdataDir(),
      gzip: false,
      // Se leen directo de la carpeta: no hay que guardar copias en ningún lado
      cacheMethod: "none",
      logger: (message) => {
        if (message.status === "recognizing text") {
          const progress = Math.round((message.progress || 0) * 100);
          console.log(`OCR: ${progress}%`);
        }
      },
    });
  }

  return workerPromise;
}

function normalizeOcrText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Renglones de producto que leyó el OCR ("1x Combo Especial MX$189.00",
 * "[2x] Aderezo especial", "1X Hamburguesa Polaca."). Sin ninguno, la lectura
 * se brincó el bloque de productos (pasó con el DiDi #4: llegó dirección y
 * totales pero ni un producto) y hay que leer otra vez de otra forma.
 */
function countProductLines(text) {
  return (String(text || "").match(/^\s*\[?\d{1,2}\s*[xX]\]?\s+\S/gm) || []).length;
}

/**
 * Modos de Tesseract a probar si la primera lectura (modo 4, una columna por
 * renglones) no trajo productos: 6 (un solo bloque), 3 (automático) y 11
 * (texto suelto). Se queda con la lectura que más productos encuentre.
 */
const RETRY_PAGESEG_MODES = ["6", "3", "11"];

/**
 * Copia del ticket sin las líneas separadoras (punteadas o sólidas): DiDi
 * encierra cada producto y el Subtotal entre líneas punteadas, y Tesseract a
 * veces toma esa franja como dibujo y se brinca el renglón ("1x Hamburguesa
 * Kansas City." del DiDi #4). Un renglón de pixeles que va oscuro en más del
 * 35% del ancho es una línea, no texto: se pinta de blanco.
 */
function withoutRuleLines(canvas) {
  const { width, height } = canvas;
  const clean = createCanvas(width, height);
  const ctx = clean.getContext("2d");
  ctx.drawImage(canvas, 0, 0);
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const isRule = new Uint8Array(height);
  for (let y = 0; y < height; y += 1) {
    let dark = 0;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (data[i] + data[i + 1] + data[i + 2] < 384) dark += 1;
    }
    if (dark / width > 0.35) isRule[y] = 1;
  }
  let removed = 0;
  for (let y = 0; y < height; y += 1) {
    // La línea y un pixel arriba y abajo (bordes suavizados)
    if (!isRule[y] && !isRule[y - 1] && !isRule[y + 1]) continue;
    removed += 1;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return { canvas: clean, removed };
}

function findOrderNumber(text) {
  const lines = String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    // Acepta #17, 17, H17, 417, etc.
    const digits = line.replace(/\D/g, "");

    if (!digits || digits.length > 6) {
      continue;
    }

    // En la zona recortada, Tesseract suele interpretar #17 como 417.
    if (/^4\d+$/.test(digits)) {
      return digits.substring(1);
    }

    return digits;
  }

  return null;
}

async function renderPdfPage(pdfPage, scale = 3) {
  const viewport = pdfPage.getViewport({ scale });

  const canvas = createCanvas(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height)
  );

  const context = canvas.getContext("2d");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  await pdfPage.render({
    canvasContext: context,
    viewport,
    canvas,
  }).promise;

  return canvas;
}

function createOrderNumberCrop(fullCanvas) {
  // Solo la zona central donde aparecen #17 y el nombre.
  const sourceX = Math.floor(fullCanvas.width * 0.30);
  const sourceY = Math.floor(fullCanvas.height * 0.07);
  const sourceWidth = Math.floor(fullCanvas.width * 0.40);
  const sourceHeight = Math.floor(fullCanvas.height * 0.16);

  const cropCanvas = createCanvas(sourceWidth, sourceHeight);
  const context = cropCanvas.getContext("2d");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, sourceWidth, sourceHeight);

  context.drawImage(
    fullCanvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight
  );

  return cropCanvas;
}

async function extractPdfTextWithOcr(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`No existe el PDF: ${filePath}`);
  }

  const pdfjsLib = await import(
    "pdfjs-dist/legacy/build/pdf.mjs"
  );

  const pdfBuffer = fs.readFileSync(filePath);
  const pdfData = new Uint8Array(pdfBuffer);

  const pdfDocument = await pdfjsLib.getDocument({
    data: pdfData,
    disableFontFace: true,
  }).promise;

  const pages = [];
  for (let n = 1; n <= pdfDocument.numPages; n += 1) {
    pages.push(() => pdfDocument.getPage(n).then((page) => renderPdfPage(page, 3)));
  }
  return ocrPages(pages);
}

/**
 * OCR de páginas dibujadas (de un PDF o las imágenes de un XPS): texto
 * completo, número de pedido y encabezado. Cada página es una función que
 * regresa su canvas, para dibujarlas de una en una.
 */
async function ocrPages(pages) {
  const worker = await getOcrWorker();
  const temporaryFiles = [];
  const pageTexts = [];
  const pageImages = [];

  let detectedOrderNumber = null;
  let detectedHeaderText = "";

  try {
    for (let pageNumber = 1; pageNumber <= pages.length; pageNumber += 1) {
      console.log(`Procesando página ${pageNumber} de ${pages.length}`);

      const fullCanvas = await pages[pageNumber - 1]();

     const fullImagePath = path.join(
  os.tmpdir(),
  `bpos-full-${Date.now()}-${pageNumber}.png`
);

fs.writeFileSync(
  fullImagePath,
  fullCanvas.toBuffer("image/png")
);

temporaryFiles.push(fullImagePath);
pageImages.push({ original: fullImagePath, canvas: fullCanvas });

// OCR GENERAL DEL TICKET
// Modo 4 (una columna, por renglones): cada producto queda con su precio en
// la misma línea ("1x Hamburguesa ... MX$129.99"); con el modo 3 los
// importes salían todos juntos al final del texto.
await worker.setParameters({
  tessedit_pageseg_mode: "4",
  tessedit_char_whitelist: "",
});

const fullResult = await worker.recognize(fullImagePath);
      const fullText = normalizeOcrText(
        fullResult?.data?.text
      );

      pageTexts.push(fullText);

      // En la primera página hacemos OCR adicional al encabezado.
      if (pageNumber === 1) {
       const headerCanvas = createOrderNumberCrop(fullCanvas);

const headerImagePath = path.join(
  os.tmpdir(),
  `bpos-header-${Date.now()}.png`
);

fs.writeFileSync(
  headerImagePath,
  headerCanvas.toBuffer("image/png")
);

temporaryFiles.push(headerImagePath);

// OCR SOLO DEL NÚMERO DE PEDIDO
await worker.setParameters({
  tessedit_pageseg_mode: "6",
  tessedit_char_whitelist: "#0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
});

const headerResult = await worker.recognize(headerImagePath);

        const headerText = normalizeOcrText(
          headerResult?.data?.text
        );

        console.log("OCR encabezado:");
        console.log(headerText);

        detectedHeaderText = headerText;
        detectedOrderNumber = findOrderNumber(headerText);

        if (!detectedOrderNumber) {
          detectedOrderNumber = findOrderNumber(fullText);
        }

        console.log(
          "Número de pedido detectado:",
          detectedOrderNumber || "No encontrado"
        );
      }
    }

    let finalText = normalizeOcrText(pageTexts.join("\n"));

    // La lectura se brincó los productos: se lee otra vez con otros modos
    // Primero sin las líneas punteadas (la causa del DiDi #4), luego otros modos
    if (countProductLines(finalText) === 0 && pageImages.length) {
      const cleanImages = pageImages.map((page, index) => {
        const { canvas } = withoutRuleLines(page.canvas);
        const file = path.join(os.tmpdir(), `bpos-clean-${Date.now()}-${index + 1}.png`);
        fs.writeFileSync(file, canvas.toBuffer("image/png"));
        temporaryFiles.push(file);
        return file;
      });
      const attempts = [
        { images: cleanImages, mode: "4", label: "sin líneas, modo 4" },
        { images: cleanImages, mode: "6", label: "sin líneas, modo 6" },
        ...RETRY_PAGESEG_MODES.map((mode) => ({ images: pageImages.map((p) => p.original), mode, label: `modo ${mode}` })),
      ];
      let best = { text: finalText, count: 0 };
      for (const attempt of attempts) {
        await worker.setParameters({ tessedit_pageseg_mode: attempt.mode, tessedit_char_whitelist: "" });
        const texts = [];
        for (const image of attempt.images) {
          const result = await worker.recognize(image);
          texts.push(normalizeOcrText(result?.data?.text));
        }
        const text = normalizeOcrText(texts.join("\n"));
        const count = countProductLines(text);
        console.log(`OCR sin productos: ${attempt.label} encontró ${count} renglón(es) de producto`);
        if (count > best.count) best = { text, count };
        if (count > 0) break;
      }
      finalText = best.text;
    }

    // Si encontramos el número, lo agregamos al principio para
    // que el parser existente pueda detectarlo.
    if (detectedOrderNumber) {
      const alreadyPresent = new RegExp(
        `#\\s*${detectedOrderNumber}\\b`
      ).test(finalText);

      if (!alreadyPresent) {
        finalText =
          `#${detectedOrderNumber}\n` + finalText;
      }
    }

    return {
  text: finalText,
  orderId: detectedOrderNumber,
  // Encabezado recortado (número y nombre del cliente en DiDi)
  headerText: detectedHeaderText,
};
  } finally {
    for (const temporaryFile of temporaryFiles) {
      try {
        if (fs.existsSync(temporaryFile)) {
          fs.unlinkSync(temporaryFile);
        }
      } catch (error) {
        console.warn(
          "No se pudo eliminar temporal:",
          error.message
        );
      }
    }
  }
}

async function terminateOcrWorker() {
  if (!workerPromise) {
    return;
  }

  try {
    const worker = await workerPromise;
    await worker.terminate();
  } finally {
    workerPromise = null;
  }
}

module.exports = {
  countProductLines,
  withoutRuleLines,
  extractPdfTextWithOcr,
  ocrPages,
  terminateOcrWorker,
};