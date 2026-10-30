const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const net = require("net");
const PDFParser = require("pdf2json");
const parserEngine = require("./lib/parser-engine");
const parseTicket = parserEngine.parseTicket || parserEngine;
const { extractPdfText } = require("./lib/pdf-reader");
const { printer: ThermalPrinter, types: PrinterTypes } = require("node-thermal-printer");
const {
  extractPdfTextWithOcr,
  terminateOcrWorker,
} = require("./lib/pdf-ocr-reader");
const { initLogger } = require("./lib/logger");
const { startDesktop } = require("./lib/desktop");
const stationPrinter = require("./lib/station-printer");
const cloudLink = require("./lib/cloud-link");

// Pruebas: otra carpeta de datos para correr junto a un B-POS instalado
if (process.env.BPOS_AGENT_PROFILE) app.setPath("userData", process.env.BPOS_AGENT_PROFILE);

// Una sola copia de B-POS Agent a la vez (los puertos 4850/9100 son únicos)
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
initLogger(app.getPath("userData"));


const server = express();

server.use(cors());
// Los tickets propios llevan el logo dentro (imagen): más que el límite de 100 KB por omisión
server.use(express.json({ limit: "5mb" }));


server.get("/", (req, res) => {
  res.json({
    service: "B-POS Agent",
    status: "running",
    version: app.getVersion(),
  });
});

let printQueue = [];

// ------------------------------------------------------------------
// Impresora virtual (127.0.0.1:9100). Con el controlador "Microsoft Print
// To PDF" cada ticket llega como PDF; también se aceptan XPS y texto.
// Todo ticket se lee, se interpreta y se sube al Bridge de B-POS en la nube;
// si algo falla se manda igual con el error, para que nunca se pierda un
// pedido (sin internet queda en espera y se sube al volver).

function saveJobFile(folder, name, buffer) {
  const dir = path.join(app.getPath("userData"), folder);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

async function readTicket(buffer) {
  const header = buffer.toString("latin1", 0, 20);

  if (header.startsWith("%PDF")) {
    const filePath = saveJobFile("pdf-jobs", `pedido-${Date.now()}.pdf`, buffer);
    let text = "";
    let extractionMethod = "pdf-text";
    let ocrResult = null;
    try {
      text = await extractPdfText(filePath);
    } catch (error) {
      console.error("No se pudo leer el texto del PDF:", error.message);
    }
    if (!text || !text.trim()) {
      console.log("PDF sin texto seleccionable. Iniciando OCR local...");
      ocrResult = await extractPdfTextWithOcr(filePath);
      text = ocrResult.text;
      extractionMethod = "tesseract-ocr";
    }
    return { format: "pdf", filePath, text, extractionMethod, ocrOrderId: ocrResult?.orderId, ocrHeader: ocrResult?.headerText };
  }

  const pkOffset = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (pkOffset !== -1) {
    const filePath = saveJobFile("xps-jobs", `pedido-${Date.now()}.xps`, buffer.slice(pkOffset));
    const ocr = await extractPdfTextWithOcr(filePath);
    return { format: "xps", filePath, text: ocr.text, extractionMethod: "tesseract-ocr", ocrOrderId: ocr.orderId, ocrHeader: ocr.headerText };
  }

  const filePath = saveJobFile("print-jobs", `job-${Date.now()}.bin`, buffer);
  // Texto plano: quitar comandos de impresora (ESC/POS, saltos de página)
  const text = buffer
    .toString("latin1")
    .replace(/\x1b[@-~]?[\x00-\x7f]?/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .trim();
  return { format: "text", filePath, text, extractionMethod: "texto" };
}

// Índice de tickets originales (plataforma, pedido → PDF) para reimprimirlos aunque B-POS se reinicie
function originalsIndexFile() {
  return path.join(app.getPath("userData"), "originales.json");
}

function readOriginalsIndex() {
  try {
    const list = JSON.parse(fs.readFileSync(originalsIndexFile(), "utf8"));
    return Array.isArray(list) ? list.filter((j) => j && j.filePath && fs.existsSync(j.filePath)) : [];
  } catch {
    return [];
  }
}

function rememberOriginal(job) {
  if (!job.filePath || !job.platform || !job.orderId || job.format === "text") return;
  try {
    const list = readOriginalsIndex().filter((j) => !(j.platform === job.platform && j.orderId === job.orderId));
    list.push({ platform: job.platform, orderId: job.orderId, filePath: job.filePath, rawText: job.rawText, receivedAt: job.receivedAt });
    fs.writeFileSync(originalsIndexFile(), JSON.stringify(list.slice(-1000)));
  } catch (error) {
    console.error("No se pudo guardar el índice de originales:", error.message);
  }
}

/** Encabezado "41 / Francisco / Plataforma" → "Francisco" (el renglón con letras que sigue al número). */
function customerFromHeader(header) {
  const lines = String(header || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const numberAt = lines.findIndex((l) => /^#?\s*\w?\d+$/.test(l));
  const candidate = lines.slice(numberAt + 1).find((l) => /[a-záéíóúñ]{2,}/i.test(l) && !/plataforma|entrega|recoger|didi/i.test(l));
  return candidate ? candidate.replace(/[^\p{L}\s.-]/gu, "").trim() || null : null;
}

async function handlePrintJob(buffer) {
  const job = {
    id: Date.now(),
    receivedAt: new Date().toISOString(),
    source: "B-POS Agent Virtual Printer",
    sizeBytes: buffer.length,
    status: "Recibido",
  };
  printQueue.push(job);

  try {
    const ticket = await readTicket(buffer);
    Object.assign(job, { format: ticket.format, filePath: ticket.filePath, extractionMethod: ticket.extractionMethod, rawText: ticket.text });

    if (!ticket.text || ticket.text.length < 10) {
      job.status = "Vacío";
      console.warn(
        `Ticket vacío (${buffer.length} bytes, ${ticket.format}). Revisa que la impresora "B-POS Agent Virtual Printer" use el controlador "Microsoft Print To PDF" (Reparar instalación lo corrige).`
      );
      return;
    }

    const parsed = parseTicket(ticket.text);
    // El número del OCR especializado (encabezado) es más confiable en DiDi y XPS
    if (ticket.ocrOrderId && (parsed.platform === "didi" || ticket.format === "xps")) parsed.orderId = ticket.ocrOrderId;
    // DiDi pone el nombre del cliente debajo del número: el OCR del encabezado lo lee mejor
    if (!parsed.customer?.name && ticket.ocrHeader) {
      const name = customerFromHeader(ticket.ocrHeader);
      if (name) parsed.customer = { ...(parsed.customer || {}), name };
    }
    Object.assign(job, parsed, { rawText: ticket.text });
    rememberOriginal(job);
  } catch (error) {
    // Se manda igual: en el Bridge se ve el texto y se resuelve a mano
    job.parseError = error.message;
    job.platform = job.platform || "otro";
    job.orderId = job.orderId || `ERROR-${job.id}`;
    console.error("No se pudo interpretar el ticket:", error);
  }

  try {
    const bridgeResult = await cloudLink.submitOrder(job);
    job.status = bridgeResult.duplicate ? "Duplicado" : bridgeResult.sent ? "Enviado a B-POS" : "En espera (sin conexión)";
    // Si el Bridge no lo manda a estaciones a tiempo, el original sale en Cocina
    if (!bridgeResult.duplicate && job.format !== "text") stationPrinter.scheduleFallback(job);
    job.sentToBposAt = new Date().toISOString();
    console.log(`${job.status}: ${job.platform}:${job.orderId} (${job.format}, ${(job.items || []).length} productos)`);
  } catch (error) {
    job.status = "Error de envío";
    job.bridgeError = error.message;
    console.error("No se pudo enviar el pedido a B-POS:", error.message);
  }
}

const virtualPrinterServer = net.createServer((socket) => {
  const chunks = [];
  socket.on("data", (chunk) => chunks.push(chunk));
  socket.on("error", (error) => console.error("Conexión de impresión:", error.message));
  socket.on("end", () => {
    handlePrintJob(Buffer.concat(chunks)).catch((error) => console.error("Error con el trabajo de impresión:", error));
  });
});

virtualPrinterServer.on("error", (error) => console.error("Impresora virtual (puerto 9100):", error.message));

virtualPrinterServer.listen(9100, "127.0.0.1", () => {
  console.log("B-POS Agent Virtual Printer escuchando en 127.0.0.1:9100");
});

async function printThermalJob(job) {
const printer = new ThermalPrinter({
  type: PrinterTypes.EPSON,
  interface: `printer:${job.printerName}`,
  options: {
    timeout: 5000,
  },
});

  printer.alignCenter();
  printer.bold(true);
  printer.println("B-POS KITCHEN");
  printer.bold(false);
  printer.println(job.station || "ESTACION");
  printer.drawLine();

  printer.alignLeft();
  printer.println(job.content || "Sin contenido");
  printer.drawLine();

  printer.alignCenter();
  printer.println("B-POS");
  printer.cut();

  const isConnected = await printer.isPrinterConnected();

  if (!isConnected) {
    throw new Error(`Impresora no conectada: ${job.printerName}`);
  }

  await printer.execute();
}

server.get("/queue", (req, res) => {
  res.json(printQueue);
});

server.get("/kds", (req, res) => {
  const pendingOrders = printQueue.filter(
    (job) =>
      job.status === "Recibido" ||
      job.status === "Pendiente"
  );

  res.json(pendingOrders);
});

// ------------------------------------------------------------------
// Lo que piden las pantallas de B-POS. Llega por la nube (cola de trabajos,
// lib/cloud-link.js) o, en pruebas sin nube, por http://localhost:4850.

async function printCommandJob(body) {
  const job = { id: Date.now(), receivedAt: new Date().toISOString(), ...body };
  printQueue.push(job);
  try {
    await printThermalJob(job);
    job.status = "Impreso";
  } catch (error) {
    console.error(error);
    job.status = "Error";
    job.error = error.message;
  }
  console.log(`Comanda ${job.station || ""} → ${job.printerName || ""}: ${job.status}`);
  return { success: true, job };
}

/** Tickets propios del pedido: uno por estación y el de la bolsa (Caja) */
async function printTicketsJob(body) {
  const { platform, orderId, tickets, force } = body || {};
  if (!platform || !orderId || !Array.isArray(tickets) || !tickets.length) throw new Error("Faltan pedido o tickets.");
  const clean = tickets
    .filter((t) => t && typeof t.html === "string" && typeof t.target === "string")
    .map((t) => ({ target: t.target, html: t.html }));
  const result = await stationPrinter.printTickets({ platform, orderId, tickets: clean, force: Boolean(force) });
  return { success: true, ...result };
}

/** Ticket ORIGINAL de la plataforma (reimpresión desde el Bridge) */
async function printOriginalJob(body) {
  const { platform, orderId, stations, force } = body || {};
  // El PDF se toma de la cola del Agent, nunca de una ruta que manden las pantallas
  const same = (j) =>
    String(j.platform || "").toLowerCase() === String(platform || "").toLowerCase() &&
    String(j.orderId || "").toUpperCase() === String(orderId || "").toUpperCase();
  // Primero la cola de esta sesión; si el Agent se reinició, el índice guardado en disco
  const job = [...printQueue].reverse().find(same) || [...readOriginalsIndex()].reverse().find(same);
  if (!job) throw new Error("El Agent no tiene el ticket original de ese pedido.");
  const result = await stationPrinter.printOriginal({
    platform,
    orderId,
    filePath: job.filePath,
    rawText: job.rawText,
    stations: Array.isArray(stations) ? stations : [],
    force: Boolean(force),
  });
  return { success: true, ...result };
}

function stationPrintersJob(body) {
  return { success: true, config: stationPrinter.setConfig(body || {}) };
}

const AGENT_JOBS = {
  print: printCommandJob,
  "print-tickets": printTicketsJob,
  "print-original": printOriginalJob,
  "station-printers": async (body) => stationPrintersJob(body),
};

server.post("/print", async (req, res) => {
  res.json(await printCommandJob(req.body));
});

server.delete("/queue", (req, res) => {
  printQueue = [];

  res.json({
    success: true,
  });
});

// Impresoras de Windows para asignar a cada estación (pantalla Configuración → Impresoras)
server.get("/printers", async (req, res) => {
  try {
    res.json({ success: true, printers: await stationPrinter.listPrinters() });
  } catch (error) {
    res.json({ success: false, printers: [], error: error.message });
  }
});

// Asignación estación → impresora y ancho de papel (la guarda el Agent para el respaldo)
server.get("/station-printers", (req, res) => {
  res.json({ success: true, config: stationPrinter.getConfig() });
});

server.post("/station-printers", (req, res) => {
  try {
    res.json(stationPrintersJob(req.body));
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

server.post("/print-tickets", async (req, res) => {
  try {
    res.json(await printTicketsJob(req.body));
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

server.post("/print-original", async (req, res) => {
  try {
    res.json(await printOriginalJob(req.body));
  } catch (error) {
    res.status(error.message.includes("no tiene el ticket") ? 404 : 500).json({ success: false, error: error.message });
  }
});

server.post("/read-pdf-ocr", async (req, res) => {
  try {
    const { file } = req.body;

    if (!file || !fs.existsSync(file)) {
      return res.status(400).json({
        success: false,
        error: "El archivo PDF no existe.",
      });
    }

    const text = await extractPdfTextWithOcr(file);
    const parsed = parseTicket(text);

    return res.json({
      success: true,
      text,
      parsed,
    });
  } catch (error) {
    console.error("Error en OCR:", error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

server
  // Solo esta computadora (pruebas sin nube); en la nube todo llega por cloud-link
  .listen(4850, "127.0.0.1", () => {
    console.log("B-POS Agent escuchando en puerto 4850");
  })
  .on("error", (error) => console.error("Agent (puerto 4850):", error.message));

// Ventana, bandeja, conexión con la nube, actualizador y reparación: lib/desktop.js
startDesktop({
  cloud: {
    handlers: AGENT_JOBS,
    listPrinters: () => stationPrinter.listPrinters(),
    applyStationPrinters: (config) => stationPrinter.setConfig(config),
  },
  onQuit: async () => {
    try {
      await terminateOcrWorker();
    } catch (error) {
      console.error("No se pudo cerrar el worker OCR:", error.message);
    }
  },
});
