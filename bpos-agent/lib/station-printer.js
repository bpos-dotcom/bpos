// Impresión del ticket ORIGINAL en las impresoras de cada estación.
//
// El Bridge solo lee el ticket para registrar la venta; el papel que llega
// a Parrilla, Freidora, Barra o Cocina es el ticket de la plataforma tal
// cual (el PDF que entró por la impresora virtual), una copia por estación.
//
// Quién decide las estaciones: la pantalla del Bridge (conoce productos,
// recetas y equivalencias) y llama a printOriginal(). Si nadie lo pide en
// FALLBACK_MS (Bridge cerrado, sin internet...), se imprime en Cocina para
// que el pedido nunca se quede sin papel.
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const { createCanvas } = require("@napi-rs/canvas");

const VIRTUAL_PRINTER = "B-POS Agent Virtual Printer";
const FALLBACK_MS = 45_000;
const STATIONS = ["Parrilla", "Freidora", "Barra", "Cocina"];

let config = null; // { printers: { Parrilla: "EPSON...", ... }, paperWidthMm: 80 }
const printed = new Map(); // "plataforma:pedido" → { at, printers }
const fallbackTimers = new Map();
let helperWindow = null;

function configFile() {
  return path.join(app.getPath("userData"), "station-printers.json");
}

function getConfig() {
  if (!config) {
    try {
      config = JSON.parse(fs.readFileSync(configFile(), "utf8"));
    } catch {
      config = { printers: {}, paperWidthMm: 80 };
    }
  }
  return config;
}

/** La pantalla de Impresoras/Bridge manda aquí la asignación estación → impresora. */
function setConfig(next) {
  const printers = {};
  for (const station of STATIONS) {
    const name = String(next?.printers?.[station] || "").trim();
    if (name && name !== VIRTUAL_PRINTER) printers[station] = name;
  }
  const width = Number(next?.paperWidthMm);
  config = { printers, paperWidthMm: width === 58 ? 58 : 80 };
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2));
  return config;
}

function getHelperWindow() {
  if (!helperWindow || helperWindow.isDestroyed()) {
    helperWindow = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
  }
  return helperWindow;
}

/** Impresoras instaladas en Windows (sin la virtual: imprimir ahí regresaría el ticket al Bridge). */
async function listPrinters() {
  const list = await getHelperWindow().webContents.getPrintersAsync();
  return list
    .filter((p) => p.name !== VIRTUAL_PRINTER)
    .map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: Boolean(p.isDefault) }));
}

/** Recuadro con contenido (lo que no es blanco) de un canvas, o null si está en blanco. */
function contentBox(canvas) {
  const { width, height } = canvas;
  const data = canvas.getContext("2d").getImageData(0, 0, width, height).data;
  let top = height, left = width, right = -1, bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  return right < 0 ? null : { left, top, right, bottom };
}

/**
 * El ticket como UNA tira continua (PNG data URL): la impresora virtual lo
 * guarda en hoja carta con mucho blanco; se recorta cada página a su
 * contenido y se unen, para que en el rollo llene el ancho del papel.
 */
async function renderTicketStrip(filePath) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(filePath)) }).promise;
  const pieces = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 1400 / base.width });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const box = contentBox(canvas);
    if (box) pieces.push({ canvas, box }); // páginas en blanco no se imprimen
  }
  if (!pieces.length) throw new Error("El ticket original está en blanco.");

  // Mismo recorte horizontal para todas las páginas (que no cambie el tamaño de letra)
  const pad = 12;
  const left = Math.max(0, Math.min(...pieces.map((p) => p.box.left)) - pad);
  const right = Math.min(pieces[0].canvas.width, Math.max(...pieces.map((p) => p.box.right)) + pad);
  const width = right - left;
  const heights = pieces.map((p) => p.box.bottom - p.box.top + 1 + pad * 2);
  const strip = createCanvas(width, heights.reduce((a, b) => a + b, 0));
  const sctx = strip.getContext("2d");
  sctx.fillStyle = "#ffffff";
  sctx.fillRect(0, 0, strip.width, strip.height);
  let y = 0;
  pieces.forEach((p, i) => {
    const top = Math.max(0, p.box.top - pad);
    sctx.drawImage(p.canvas, left, top, width, heights[i], 0, y, width, heights[i]);
    y += heights[i];
  });
  return { dataUrl: `data:image/png;base64,${strip.toBuffer("image/png").toString("base64")}`, width: strip.width, height: strip.height };
}

/** Manda el PDF a una impresora de Windows sin mostrar diálogos. */
async function printPdf(filePath, printerName) {
  if (printerName === VIRTUAL_PRINTER) throw new Error("No se puede imprimir en la impresora virtual de B-POS.");
  const strip = await renderTicketStrip(filePath);
  const widthMm = getConfig().paperWidthMm || 80;
  // Papel continuo: el alto es el del ticket completo (en micras)
  const pageSize = { width: widthMm * 1000, height: Math.max(10000, Math.round(widthMm * 1000 * (strip.height / strip.width))) };

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 0; } html, body { margin: 0; padding: 0; background: #fff; }
    img { display: block; width: 100%; height: auto; }
  </style></head><body><img src="${strip.dataUrl}"></body></html>`;

  const win = new BrowserWindow({ show: false });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await win.webContents.executeJavaScript(
      "Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = r; i.onerror = r; })))"
    );
    await new Promise((resolve, reject) => {
      win.webContents.print(
        { silent: true, deviceName: printerName, printBackground: true, margins: { marginType: "none" }, pageSize },
        (ok, reason) => (ok ? resolve() : reject(new Error(reason || "La impresora rechazó el trabajo.")))
      );
    });
  } finally {
    win.destroy();
  }
}

function orderKey(platform, orderId) {
  return `${String(platform || "").toLowerCase()}:${String(orderId || "").toUpperCase()}`;
}

/**
 * Imprime el ticket original en las impresoras de las estaciones indicadas
 * (una sola vez por pedido). Estaciones sin impresora van a la de Cocina.
 * @param {{ platform: string, orderId: string, filePath: string, stations: string[], reason?: string }} req
 */
async function printOriginal(req) {
  const key = orderKey(req.platform, req.orderId);
  clearTimeout(fallbackTimers.get(key));
  fallbackTimers.delete(key);
  if (printed.has(key)) return { alreadyPrinted: true, ...printed.get(key) };
  if (!req.filePath || !fs.existsSync(req.filePath)) throw new Error("No está el PDF original de este pedido.");

  const { printers } = getConfig();
  const targets = new Map(); // impresora → estaciones (si dos estaciones comparten impresora, sale un solo papel)
  const missing = [];
  for (const station of new Set(req.stations?.length ? req.stations : ["Cocina"])) {
    const printer = printers[station] || printers.Cocina;
    if (!printer) {
      missing.push(station);
      continue;
    }
    targets.set(printer, [...(targets.get(printer) || []), station]);
  }
  // Se marca antes de imprimir: si llegan dos pedidos iguales a la vez, sale un solo papel
  const record = { at: new Date().toISOString(), printers: [...targets.keys()], stations: req.stations, reason: req.reason || "bridge" };
  printed.set(key, record);

  const results = [];
  for (const [printer, stations] of targets) {
    try {
      await printPdf(req.filePath, printer);
      results.push({ printer, stations, ok: true });
      console.log(`Ticket original ${key} impreso en "${printer}" (${stations.join(", ")})`);
    } catch (error) {
      results.push({ printer, stations, ok: false, error: error.message });
      console.error(`No se pudo imprimir ${key} en "${printer}":`, error.message);
    }
  }
  if (missing.length) console.warn(`Sin impresora asignada para ${missing.join(", ")} ni para Cocina: el ticket ${key} no se imprimió ahí.`);
  if (!results.some((r) => r.ok)) printed.delete(key); // nada salió: se puede reintentar
  return { ...record, results, missing };
}

/** Al llegar un pedido: si el Bridge no lo manda a estaciones a tiempo, sale en Cocina. */
function scheduleFallback(job) {
  if (!job?.filePath || !job.platform || !job.orderId) return;
  const key = orderKey(job.platform, job.orderId);
  if (printed.has(key) || fallbackTimers.has(key)) return;
  fallbackTimers.set(
    key,
    setTimeout(() => {
      fallbackTimers.delete(key);
      console.warn(`El Bridge no indicó estaciones para ${key}: se imprime en Cocina.`);
      printOriginal({ platform: job.platform, orderId: job.orderId, filePath: job.filePath, stations: ["Cocina"], reason: "respaldo" }).catch((e) =>
        console.error(`Respaldo de impresión ${key}:`, e.message)
      );
    }, FALLBACK_MS)
  );
}

module.exports = { listPrinters, printOriginal, scheduleFallback, getConfig, setConfig, renderTicketStrip, VIRTUAL_PRINTER };
