const { app, BrowserWindow, Tray, Menu } = require("electron");
const path = require("path");
const express = require("express");
const cors = require("cors");
const net = require("net");
const { exec } = require("child_process");
const { printer: ThermalPrinter, types: PrinterTypes } = require("node-thermal-printer");

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
  let rawData = "";

  socket.on("data", (chunk) => {
    rawData += chunk.toString("utf8");
  });

  socket.on("end", () => {
    const job = {
      id: Date.now(),
      receivedAt: new Date().toISOString(),
      source: "Virtual Printer",
      station: "Bridge",
      printerName: "B-POS Agent Virtual Printer",
      content: rawData,
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

server.get("/queue", (req, res) => {
  res.json(printQueue);
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