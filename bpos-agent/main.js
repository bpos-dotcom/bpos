const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const net = require("net");
const PDFParser = require("pdf2json");
const { exec } = require("child_process");
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

// Bloque 13: una sola copia de B-POS a la vez (los puertos 3000/4850/9100 son únicos)
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
initLogger(app.getPath("userData"));


const server = express();

server.use(cors());
server.use(express.json());


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
// Todo ticket se lee, se interpreta y se manda al Bridge de B-POS; si algo
// falla se manda igual con el error, para que nunca se pierda un pedido.

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
    return { format: "pdf", filePath, text, extractionMethod, ocrOrderId: ocrResult?.orderId };
  }

  const pkOffset = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (pkOffset !== -1) {
    const filePath = saveJobFile("xps-jobs", `pedido-${Date.now()}.xps`, buffer.slice(pkOffset));
    const ocr = await extractPdfTextWithOcr(filePath);
    return { format: "xps", filePath, text: ocr.text, extractionMethod: "tesseract-ocr", ocrOrderId: ocr.orderId };
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
    Object.assign(job, parsed, { rawText: ticket.text });
  } catch (error) {
    // Se manda igual: en el Bridge se ve el texto y se resuelve a mano
    job.parseError = error.message;
    job.platform = job.platform || "otro";
    job.orderId = job.orderId || `ERROR-${job.id}`;
    console.error("No se pudo interpretar el ticket:", error);
  }

  try {
    const bridgeResult = await sendOrderToBpos(job);
    job.status = bridgeResult.duplicate ? "Duplicado" : "Enviado a B-POS";
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
  printer.println("Burger Planet OS");
  printer.cut();

  const isConnected = await printer.isPrinterConnected();

  if (!isConnected) {
    throw new Error(`Impresora no conectada: ${job.printerName}`);
  }

  await printer.execute();
}

// Llave que crea B-POS en ~/.bpos/agent-key para aceptar pedidos de este Agent
function readAgentKey() {
  try {
    return fs.readFileSync(path.join(require("os").homedir(), ".bpos", "agent-key"), "utf8").trim();
  } catch {
    return "";
  }
}

async function sendOrderToBpos(job) {
  const agentKey = readAgentKey();
  const response = await fetch(
    "http://localhost:3000/api/bridge/orders",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(agentKey ? { "x-bpos-agent-key": agentKey } : {}),
      },
      body: JSON.stringify(job),
    }
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      result?.error || `B-POS respondió ${response.status}`
    );
  }

  return result;
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

server.post("/print", async (req, res) => {
  const job = {
    id: Date.now(),
    receivedAt: new Date().toISOString(),
    ...req.body,
  };

  printQueue.push(job);

  try {
  await printThermalJob(job);
  job.status = "Impreso";
} catch (error) {
  console.error(error);
  job.status = "Error";
  job.error = error.message;
}

  console.log("==============");
  console.log("Nuevo trabajo recibido por B-POS Agent");
  console.log(job.station);
  console.log(job.printerName);
  console.log(job.content);
  console.log("==============");

  res.json({
    success: true,
    job,
  });
});

server.delete("/queue", (req, res) => {
  printQueue = [];

  res.json({
    success: true,
  });
});

server.get("/printers", (req, res) => {
  exec(
    "lpstat -v || lpstat -p || system_profiler SPPrintersDataType",
    (error, stdout, stderr) => {
      if (error) {
        return res.json({
          success: false,
          printers: [],
          error: error.message,
          stderr,
        });
      }

      res.json({
        success: true,
        raw: stdout,
      });
    }
  );
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
  // Solo esta computadora: el navegador de la caja llama a localhost:4850
  .listen(4850, "127.0.0.1", () => {
    console.log("B-POS Agent escuchando en puerto 4850");
  })
  .on("error", (error) => console.error("Agent (puerto 4850):", error.message));

// Ventana, bandeja, servidor de B-POS, actualizador y reparación: lib/desktop.js
startDesktop({
  onQuit: async () => {
    try {
      await terminateOcrWorker();
    } catch (error) {
      console.error("No se pudo cerrar el worker OCR:", error.message);
    }
  },
});
