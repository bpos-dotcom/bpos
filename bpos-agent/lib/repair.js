// Reparar instalación de B-POS Agent.
// Revisa las piezas en esta computadora y arregla lo que pueda: impresora
// virtual, inicio automático y conexión con la nube. Regresa una lista de lo
// que hizo.
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

function run(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 120000 }, (error, stdout, stderr) =>
      resolve({ ok: !error, out: `${stdout || ""}${stderr || ""}`.trim(), error })
    );
  });
}

// Registro del instalador de la impresora (lo escribe install-virtual-printer.ps1)
const PRINTER_LOG = path.join(process.env.ProgramData || "C:\\ProgramData", "B-POS", "virtual-printer.log");
// Controladores que dejan bien la impresora: PDF (texto) y PWG Raster (imagen + OCR).
// Con XPS las letras llegan como dibujos y el OCR las lee mal: se marca para reparar
// y así se cambia sola a PWG. Con "Generic / Text Only" los tickets llegan vacíos.
const PRINTER_DRIVERS = ["Microsoft Print To PDF", "Microsoft Virtual Print Class Driver", "Microsoft PWG Raster Class Driver"];
const PWG_DRIVER = "Microsoft PWG Raster Class Driver";

/** El error que dejó el instalador de la impresora (si lo hubo). */
function printerLogError() {
  try {
    const lines = fs.readFileSync(PRINTER_LOG, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
    const error = lines.reverse().find((l) => l.includes("ERROR:"));
    return error ? error.slice(error.indexOf("ERROR:") + 6).trim() : null;
  } catch {
    return null;
  }
}

/**
 * Estado de la impresora virtual: que exista, con un controlador que sirva y en el puerto 9100.
 * Con PWG Raster dice además si Windows ya tiene el controlador PDF (pdfReady), para
 * pasarla a PDF: con PDF los tickets con texto se leen exactos, sin OCR.
 */
async function printerStatus() {
  const list = PRINTER_DRIVERS.map((d) => `'${d}'`).join(",");
  const r = await run("powershell.exe", [
    "-NoProfile",
    "-Command",
    `$p = Get-Printer -Name 'B-POS Agent Virtual Printer' -ErrorAction SilentlyContinue; if (-not $p) { 'falta' } elseif ($p.DriverName -notin @(${list})) { 'controlador|' + $p.DriverName } elseif ($p.PortName -ne '9100') { 'puerto|' + $p.PortName } else { $pdf = if ((Get-PrinterDriver -Name 'Microsoft Print To PDF' -ErrorAction SilentlyContinue) -or (Test-Path ($env:windir + '\\System32\\DriverStore\\FileRepository\\prnms009.inf_*\\prnms009.inf'))) { 'pdf' } else { 'no' }; 'si|' + $p.DriverName + '|' + $pdf }`,
  ]);
  const [state, detail, pdf] = r.out.trim().split("|");
  if (state === "si") return { ok: true, driver: detail, pwg: detail === PWG_DRIVER, pdfReady: pdf === "pdf", message: "Instalada" };
  if (state === "controlador") return { ok: false, message: `Usa el controlador "${detail}": usa Reparar instalación` };
  if (state === "puerto") return { ok: false, message: `Usa el puerto "${detail}": usa Reparar instalación` };
  return { ok: false, message: "No está instalada: usa Reparar instalación" };
}

function printerLogHas(text) {
  try {
    return fs.readFileSync(PRINTER_LOG, "utf8").includes(text);
  } catch {
    return false;
  }
}

/** Impresora virtual (necesita permisos de administrador: Windows lo pregunta). */
async function reinstallVirtualPrinter(resourcesDir) {
  const script = path.join(resourcesDir, "virtual-printer", "install-virtual-printer.ps1");
  if (!fs.existsSync(script)) return { ok: false, text: "No está el instalador de la impresora virtual." };
  const inner = `-NoProfile -ExecutionPolicy Bypass -File "${script}"`;
  const result = await run("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '${inner.replace(/'/g, "''")}'`,
  ]);
  if (!result.ok) return { ok: false, text: "No se pudo instalar la impresora virtual (¿se canceló el permiso de administrador?)." };
  // Que PowerShell haya terminado no quiere decir que quedó: se revisa
  const status = await printerStatus();
  if (status.ok) {
    const restart = status.pwg && printerLogHas("pide reiniciar");
    return { ok: true, text: `Impresora virtual instalada (${status.driver}).${restart ? " Reinicia la computadora para que pase a PDF." : ""}` };
  }
  const reason = printerLogError();
  return {
    ok: false,
    text: reason
      ? `No se pudo instalar la impresora virtual: ${reason}`
      : "No se pudo instalar la impresora virtual. Manda a soporte el archivo C:\\ProgramData\\B-POS\\virtual-printer.log.",
  };
}

/**
 * @param {{ resourcesDir: string, setAutoStart: () => void, cloudStatus: () => { linked: boolean, state: string, message: string } }} ctx
 */
async function repairInstallation(ctx) {
  const steps = [];
  const add = (ok, text) => {
    steps.push({ ok, text });
    console.log(`[reparar] ${ok ? "OK" : "FALLA"} ${text}`);
  };

  const printer = await printerStatus();
  // Con PWG se vuelve a correr el instalador: intenta tener el controlador PDF y pasarla a PDF
  if (printer.ok && !printer.pwg) add(true, `Impresora virtual instalada (${printer.driver}).`);
  else {
    const r = await reinstallVirtualPrinter(ctx.resourcesDir);
    add(r.ok, r.text);
  }

  try {
    ctx.setAutoStart();
    add(true, "Inicio automático con Windows activado.");
  } catch (error) {
    add(false, `No se pudo activar el inicio automático: ${error.message}`);
  }

  const c = ctx.cloudStatus();
  if (!c.linked) add(false, "Esta computadora no está vinculada: escribe el código de B-POS → Configuración → Sistema.");
  else add(c.state === "connected", c.state === "connected" ? "Conectado a B-POS en la nube." : `Nube: ${c.message}`);

  return steps;
}

module.exports = { repairInstallation, reinstallVirtualPrinter, printerStatus };
