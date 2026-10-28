// Bloque 13 · Reparar instalación.
// Revisa las piezas de B-POS en esta computadora y arregla lo que pueda:
// archivos del sistema, impresora virtual, inicio automático, llave del
// Agent y servidor. Regresa una lista de lo que hizo.
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
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

async function printerExists() {
  const r = await run("powershell.exe", ["-NoProfile", "-Command", "if (Get-Printer -Name 'B-POS Agent Virtual Printer' -ErrorAction SilentlyContinue) { 'si' } else { 'no' }"]);
  return r.out.includes("si");
}

/**
 * @param {{ resourcesDir: string, webDir: string, setAutoStart: () => void, restartServer: () => Promise<{state:string,message:string}> }} ctx
 */
async function repairInstallation(ctx) {
  const steps = [];
  const add = (ok, text) => {
    steps.push({ ok, text });
    console.log(`[reparar] ${ok ? "OK" : "FALLA"} ${text}`);
  };

  const serverOk = fs.existsSync(path.join(ctx.webDir, "server.js")) && fs.existsSync(path.join(ctx.webDir, ".next"));
  add(serverOk, serverOk ? "Archivos del sistema completos." : "Faltan archivos del sistema: descarga e instala de nuevo B-POS (no se borran tus datos).");

  if (await printerExists()) add(true, "Impresora virtual instalada.");
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

  const keyFile = path.join(os.homedir(), ".bpos", "agent-key");
  if (fs.existsSync(keyFile)) add(true, "Llave del Agent presente.");
  else add(true, "La llave del Agent se volverá a crear al arrancar el servidor.");

  const s = await ctx.restartServer();
  add(s.state === "running", s.state === "running" ? "Servidor de B-POS reiniciado y respondiendo." : `Servidor: ${s.message}`);

  return steps;
}

module.exports = { repairInstallation, reinstallVirtualPrinter };
