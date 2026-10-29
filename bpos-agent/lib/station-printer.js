// Impresión de los pedidos de delivery en las impresoras del negocio.
//
// El Bridge solo lee el ticket de la plataforma para registrar la venta. Lo
// que sale en papel son tickets propios de Burger Planet (printTickets):
// uno por estación con solo lo suyo, y el de la bolsa en Caja. Los arma la
// pantalla del Bridge (conoce productos, recetas y equivalencias).
//
// Respaldo: si nadie pide imprimir en FALLBACK_MS (Bridge cerrado, sin
// internet...), sale el ticket ORIGINAL de la plataforma en Cocina para que
// el pedido nunca se quede sin papel. El original también se puede
// reimprimir a mano (printOriginal con force).
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createCanvas } = require("@napi-rs/canvas");
const { printImageEscPos } = require("./raw-printer");

const VIRTUAL_PRINTER = "B-POS Agent Virtual Printer";
const FALLBACK_MS = 45_000;
const STATIONS = ["Parrilla", "Freidora", "Barra", "Cocina", "Caja"];
/** Ancho de dibujo = puntos del cabezal: 384 en 58 mm, 576 en 80 mm (203 dpi). Así la letra no se encoge. */
function ticketWidthPx() {
  return getConfig().paperWidthMm === 58 ? 384 : 576;
}

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
      config = { printers: {}, paperWidthMm: 80, printMode: "escpos" };
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
  // escpos: directo a la térmica (recomendado). windows: por el controlador (impresoras de hoja)
  const printMode = next?.printMode === "windows" ? "windows" : "escpos";
  config = { printers, paperWidthMm: width === 58 ? 58 : 80, printMode };
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

/**
 * Carga HTML desde un archivo temporal: como dirección "data:" falla cuando
 * el ticket es largo o lleva imágenes (límite de ~2 MB de Chromium).
 */
async function loadHtml(win, html) {
  const file = path.join(os.tmpdir(), `bpos-ticket-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`);
  fs.writeFileSync(file, html, "utf8");
  try {
    await win.loadFile(file);
  } finally {
    fs.rm(file, { force: true }, () => {});
  }
}

/** Manda una imagen (tira del ancho del ticket) a una impresora de Windows sin diálogos. */
async function printImage(image, printerName) {
  if (printerName === VIRTUAL_PRINTER) throw new Error("No se puede imprimir en la impresora virtual de B-POS.");
  const widthMm = getConfig().paperWidthMm || 80;
  // Térmicas: directo en ESC/POS. Por el controlador de Windows salían en blanco (ej. XP-58)
  if (getConfig().printMode !== "windows") return printImageEscPos(image, printerName, widthMm);
  // Papel continuo: el alto es el del ticket completo (en micras)
  const pageSize = { width: widthMm * 1000, height: Math.max(10000, Math.round(widthMm * 1000 * (image.height / image.width))) };

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 0; } html, body { margin: 0; padding: 0; background: #fff; }
    img { display: block; width: 100%; height: auto; }
  </style></head><body><img src="${image.dataUrl}"></body></html>`;

  const win = new BrowserWindow({ show: false });
  try {
    await loadHtml(win, html);
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

async function printPdf(filePath, printerName) {
  await printImage(await renderTicketStrip(filePath), printerName);
}

/**
 * Ticket propio (HTML de B-POS) → imagen. Se dibuja al ancho del papel y se
 * captura como foto: así sale idéntico en cualquier térmica, sin depender
 * de cómo el controlador acomode el texto.
 */
async function renderHtmlTicket(html) {
  // Ventana chica: así el alto medido es el del contenido y no el de la ventana
  const width = ticketWidthPx();
  const win = new BrowserWindow({ show: false, width, height: 100, useContentSize: true });
  try {
    await loadHtml(win, html);
    const height = await win.webContents.executeJavaScript(
      "Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = r; i.onerror = r; }))).then(() => Math.ceil(document.body.getBoundingClientRect().bottom))"
    );
    const h = Math.max(100, height);
    win.setContentSize(width, h);
    await new Promise((r) => setTimeout(r, 150)); // que repinte con el nuevo alto
    const shot = await win.webContents.capturePage({ x: 0, y: 0, width, height: h });
    const size = shot.getSize();
    return { dataUrl: shot.toDataURL(), width: size.width, height: size.height };
  } finally {
    win.destroy();
  }
}

function orderKey(platform, orderId) {
  return `${String(platform || "").toLowerCase()}:${String(orderId || "").toUpperCase()}`;
}

/** Impresora de cada destino: estación sin impresora → la de Cocina; Caja no se reemplaza. */
function printerFor(target) {
  const { printers } = getConfig();
  if (target === "Caja") return printers.Caja || null;
  return printers[target] || printers.Cocina || null;
}

/**
 * Tickets propios de un pedido: uno por estación y el de la bolsa en Caja.
 * Una sola vez por pedido salvo `force` (reimpresión desde el Bridge).
 * @param {{ platform: string, orderId: string, tickets: { target: string, html: string }[], force?: boolean }} req
 */
async function printTickets(req) {
  const key = orderKey(req.platform, req.orderId);
  clearTimeout(fallbackTimers.get(key));
  fallbackTimers.delete(key);
  if (printed.has(key) && !req.force) return { alreadyPrinted: true, ...printed.get(key) };

  const record = { at: new Date().toISOString(), targets: req.tickets.map((t) => t.target), reason: req.force ? "reimpresion" : "bridge" };
  printed.set(key, record);

  const results = [];
  for (const ticket of req.tickets) {
    const printer = printerFor(ticket.target);
    if (!printer) {
      results.push({ target: ticket.target, ok: false, error: `Sin impresora asignada para ${ticket.target}.` });
      console.warn(`Sin impresora para ${ticket.target}: el ticket ${key} no se imprimió ahí.`);
      continue;
    }
    try {
      await printImage(await renderHtmlTicket(ticket.html), printer);
      results.push({ target: ticket.target, printer, ok: true });
      console.log(`Ticket ${key} (${ticket.target}) impreso en "${printer}"`);
    } catch (error) {
      results.push({ target: ticket.target, printer, ok: false, error: error.message });
      console.error(`No se pudo imprimir ${key} (${ticket.target}) en "${printer}":`, error.message);
    }
  }
  if (!results.some((r) => r.ok) && !req.force) printed.delete(key); // nada salió: se puede reintentar
  return { ...record, results };
}

/** HTML del ticket original como texto (renglón por renglón, tal como lo leyó el Agent). */
function originalTextHtml(req) {
  const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const b = getConfig().paperWidthMm === 58 ? 20 : 26;
  const lines = String(req.rawText || "").replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; background: #fff; color: #000; overflow: hidden; }
    body { width: 100%; padding: 6px 4px 14px; font-family: Arial, Helvetica, sans-serif; font-size: ${b}px; line-height: 1.25; font-weight: 700; }
    .head { text-align: center; font-size: ${b * 1.3}px; font-weight: 900; border: 4px solid #000; padding: 4px 0; margin-bottom: 8px; }
    p { margin: 0 0 3px; overflow-wrap: anywhere; }
  </style></head><body>
    <div class="head">TICKET ORIGINAL<br>${esc(String(req.platform || "").toUpperCase())} #${esc(req.orderId)}</div>
    ${lines.map((l) => `<p>${esc(l)}</p>`).join("")}
  </body></html>`;
}

/**
 * Ticket original de la plataforma en las impresoras de esas estaciones:
 * respaldo automático (Cocina) o reimpresión a mano desde el Bridge (force).
 * @param {{ platform: string, orderId: string, filePath: string, stations: string[], reason?: string, force?: boolean }} req
 */
async function printOriginal(req) {
  const key = orderKey(req.platform, req.orderId);
  clearTimeout(fallbackTimers.get(key));
  fallbackTimers.delete(key);
  if (printed.has(key) && !req.force) return { alreadyPrinted: true, ...printed.get(key) };
  const hasText = typeof req.rawText === "string" && req.rawText.trim().length > 20;
  if (!hasText && (!req.filePath || !fs.existsSync(req.filePath))) throw new Error("No está el ticket original de este pedido.");

  const targets = new Map(); // impresora → estaciones (si dos estaciones comparten impresora, sale un solo papel)
  const missing = [];
  for (const station of new Set(req.stations?.length ? req.stations : ["Cocina"])) {
    const printer = printerFor(station);
    if (!printer) {
      missing.push(station);
      continue;
    }
    targets.set(printer, [...(targets.get(printer) || []), station]);
  }
  const record = { at: new Date().toISOString(), printers: [...targets.keys()], stations: req.stations, reason: req.reason || "bridge" };
  if (!req.force) printed.set(key, record); // se marca antes de imprimir: un solo papel aunque lleguen dos peticiones

  const results = [];
  for (const [printer, stations] of targets) {
    try {
      // El original como texto en letra grande: la hoja de la plataforma reducida a 58/80 mm salía diminuta
      if (hasText) await printImage(await renderHtmlTicket(originalTextHtml(req)), printer);
      else await printPdf(req.filePath, printer);
      results.push({ printer, stations, ok: true });
      console.log(`Ticket original ${key} impreso en "${printer}" (${stations.join(", ")})`);
    } catch (error) {
      results.push({ printer, stations, ok: false, error: error.message });
      console.error(`No se pudo imprimir ${key} en "${printer}":`, error.message);
    }
  }
  if (missing.length) console.warn(`Sin impresora asignada para ${missing.join(", ")} ni para Cocina: el ticket ${key} no se imprimió ahí.`);
  if (!results.some((r) => r.ok) && !req.force) printed.delete(key);
  return { ...record, results, missing };
}

/** Al llegar un pedido: si el Bridge no pide sus tickets a tiempo, sale el original en Cocina. */
function scheduleFallback(job) {
  if (!job?.filePath || !job.platform || !job.orderId) return;
  const key = orderKey(job.platform, job.orderId);
  if (printed.has(key) || fallbackTimers.has(key)) return;
  fallbackTimers.set(
    key,
    setTimeout(() => {
      fallbackTimers.delete(key);
      console.warn(`El Bridge no pidió los tickets de ${key}: sale el original en Cocina.`);
      printOriginal({ platform: job.platform, orderId: job.orderId, filePath: job.filePath, stations: ["Cocina"], reason: "respaldo" }).catch((e) =>
        console.error(`Respaldo de impresión ${key}:`, e.message)
      );
    }, FALLBACK_MS)
  );
}

module.exports = { listPrinters, printTickets, printOriginal, scheduleFallback, getConfig, setConfig, renderTicketStrip, renderHtmlTicket, originalTextHtml, VIRTUAL_PRINTER };
