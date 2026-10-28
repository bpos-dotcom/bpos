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

  const worker = await getOcrWorker();
  const temporaryFiles = [];
  const pageTexts = [];

  let detectedOrderNumber = null;

  try {
    for (
      let pageNumber = 1;
      pageNumber <= pdfDocument.numPages;
      pageNumber += 1
    ) {
      console.log(
        `Procesando página ${pageNumber} de ${pdfDocument.numPages}`
      );

      const page = await pdfDocument.getPage(pageNumber);
      const fullCanvas = await renderPdfPage(page, 3);

     const fullImagePath = path.join(
  os.tmpdir(),
  `bpos-full-${Date.now()}-${pageNumber}.png`
);

fs.writeFileSync(
  fullImagePath,
  fullCanvas.toBuffer("image/png")
);

temporaryFiles.push(fullImagePath);

// OCR GENERAL DEL TICKET
await worker.setParameters({
  tessedit_pageseg_mode: "3",
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
  extractPdfTextWithOcr,
  terminateOcrWorker,
};