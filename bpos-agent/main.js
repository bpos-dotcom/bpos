const { app, BrowserWindow, Tray, Menu } = require("electron");
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


const server = express();

server.use(cors());
server.use(express.json());

let tray = null;
let mainWindow = null;

server.get("/", (req, res) => {
  res.json({
    service: "B-POS Agent",
    status: "running",
    version: "1.0.0",
  });
});

let printQueue = [];

const virtualPrinterServer = net.createServer((socket) => {
  let chunks = [];

socket.on("data", (chunk) => {
  chunks.push(chunk);
});

  socket.on("end", async() => {
    const buffer = Buffer.concat(chunks);
    const header = buffer.toString("utf8", 0, 20);

if (header.startsWith("%PDF")) {
  const jobsDir = path.join(app.getPath("userData"), "pdf-jobs");

  if (!fs.existsSync(jobsDir)) {
    fs.mkdirSync(jobsDir, { recursive: true });
  }

  const filePath = path.join(jobsDir, `pedido-${Date.now()}.pdf`);
  fs.writeFileSync(filePath, buffer);
let text = await extractPdfText(filePath);
let extractionMethod = "pdf-text";
let ocrResult = null;

if (!text || !text.trim()) {
  console.log("PDF sin texto seleccionable. Iniciando OCR local...");

  ocrResult = await extractPdfTextWithOcr(filePath);
  text = ocrResult.text;
  extractionMethod = "tesseract-ocr";
}

const parsed = parseTicket(text);

// El número OCR especializado solo se usa para DiDi.
// Uber y Rappi tienen identificadores con otros formatos.
if (parsed.platform === "didi" && ocrResult?.orderId) {
  parsed.orderId = ocrResult.orderId;
}

const job = {
  id: Date.now(),
  receivedAt: new Date().toISOString(),
  source: "B-POS Agent Virtual Printer",
  format: "pdf",
  extractionMethod,
  filePath,
  ...parsed,
  rawText: text,
  status: "Recibido",
};

printQueue.push(job);

try {
  const bridgeResult = await sendOrderToBpos(job);

  if (bridgeResult.duplicate) {
    job.status = "Duplicado";
    console.log(
      `Pedido duplicado ignorado por B-POS: ${job.platform}:${job.orderId}`
    );
  } else {
    job.status = "Enviado a B-POS";
    job.sentToBposAt = new Date().toISOString();

    console.log(
      `Pedido enviado a B-POS: ${job.platform}:${job.orderId}`
    );
  }
} catch (error) {
  job.status = "Error de envío";
  job.bridgeError = error.message;

  console.error(
    "No se pudo enviar el pedido a B-POS:",
    error.message
  );
}

console.log("PDF recibido y procesado desde impresora virtual");
console.log(job);

return;

  printQueue.push(job);

  console.log("XPS recibido y procesado desde impresora virtual");
  console.log(job);

  return;
}

const pkOffset = buffer.indexOf(Buffer.from([0x50, 0x4B, 0x03, 0x04]));

if (pkOffset !== -1) {
  const jobsDir = path.join(app.getPath("userData"), "xps-jobs");

  if (!fs.existsSync(jobsDir)) {
    fs.mkdirSync(jobsDir, { recursive: true });
  }

  const xpsBuffer = buffer.slice(pkOffset);
  const filePath = path.join(jobsDir, `pedido-${Date.now()}.xps`);

  fs.writeFileSync(filePath, xpsBuffer);

 const ocr = await extractPdfTextWithOcr(filePath);

const parsed = parseTicket(ocr.text);

// El número detectado por el OCR especializado del encabezado
// tiene prioridad sobre cualquier detección del parser.
parsed.orderId = ocr.orderId;

const job = {
  id: Date.now(),
  receivedAt: new Date().toISOString(),
  source: "B-POS Agent Virtual Printer",
  format: "pdf",
  extractionMethod: "tesseract-ocr",
  filePath,
  ...parsed,
  rawText: ocr.text,
  status: "Recibido",
};

  printQueue.push(job);

  console.log("XPS recibido y procesado");
  console.log(job);

  return;
}

    const jobsDir = path.join(app.getPath("userData"), "print-jobs");

if (!fs.existsSync(jobsDir)) {
  fs.mkdirSync(jobsDir, { recursive: true });
}

const filePath = path.join(jobsDir, `job-${Date.now()}.bin`);
fs.writeFileSync(filePath, buffer);
const rawData = buffer.toString("utf8");
const hexPreview = buffer.toString("hex").slice(0, 500);
    const job = {
      id: Date.now(),
      receivedAt: new Date().toISOString(),
      source: "Virtual Printer",
      station: "Bridge",
      printerName: "B-POS Agent Virtual Printer",
      content: rawData,
      sizeBytes: buffer.length,
      hexPreview: hexPreview,
      filePath: filePath,
      status: "Recibido",
    };

    printQueue.push(job);

    console.log("==============");
    console.log("Trabajo recibido desde impresora virtual");
    console.log(rawData);
    console.log("==============");
  });
});

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

server.listen(4850, () => {
  console.log("B-POS Agent escuchando en puerto 4850");
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 700,
    height: 520,
    title: "B-POS Agent",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadFile("index.html");
}

app.on("before-quit", async () => {
  try {
    await terminateOcrWorker();
  } catch (error) {
    console.error("No se pudo cerrar el worker OCR:", error.message);
  }
});

app.whenReady().then(() => {
  createWindow();

  try {
    tray = new Tray(path.join(__dirname, "icon.png"));

    const menu = Menu.buildFromTemplate([
      {
        label: "Abrir B-POS Agent",
        click() {
          mainWindow.show();
        },
      },
      {
        type: "separator",
      },
      {
        label: "Salir",
        click() {
          app.quit();
        },
      },
    ]);

    tray.setToolTip("B-POS Agent");
    tray.setContextMenu(menu);
  } catch (error) {
    console.log("Icono de bandeja no disponible todavía.");
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});