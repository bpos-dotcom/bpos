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
  return result.ok
    ? { ok: true, text: "Impresora virtual revisada." }
    : { ok: false, text: "No se pudo instalar la impresora virtual (¿se canceló el permiso de administrador?)." };
}

/** La impresora existe y usa el controlador PDF (con "Generic / Text Only" los tickets llegan vacíos). */
async function printerOk() {
  const r = await run("powershell.exe", [
    "-NoProfile",
    "-Command",
    "$p = Get-Printer -Name 'B-POS Agent Virtual Printer' -ErrorAction SilentlyContinue; if ($p -and $p.DriverName -in @('Microsoft Print To PDF','Microsoft Virtual Print Class Driver') -and $p.PortName -eq '9100') { 'si' } else { 'no' }",
  ]);
  return r.out.includes("si");
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

  if (await printerOk()) add(true, "Impresora virtual instalada (controlador PDF).");
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

module.exports = { repairInstallation, reinstallVirtualPrinter };
