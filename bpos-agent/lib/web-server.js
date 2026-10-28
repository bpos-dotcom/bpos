// Bloque 13 · Servidor de B-POS en segundo plano.
// Corre el build de producción de B-POS (resources/web/server.js) con el
// Node que trae Electron, en el puerto 3000 y visible en la red local
// (celulares, tablets, cocina). Si se cae, lo vuelve a levantar.
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");
const { logLines } = require("./logger");

// BPOS_PORT solo para pruebas: en uso real debe ser 3000 (los datos del navegador dependen del puerto)
const PORT = Number(process.env.BPOS_PORT) || 3000;
const listeners = new Set();

let child = null;
let stopping = false;
let restarts = 0;
let restartTimer = null;
let status = { state: "stopped", message: "Detenido", version: null, pid: null };

function setStatus(patch) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l(status));
}

function onStatus(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}

function getJson(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

/** Versión que contesta el servidor que está en el puerto 3000 (o null). */
function checkServerVersion() {
  return getJson(`http://127.0.0.1:${PORT}/api/version`);
}

async function waitUntilReady(timeoutMs = 60000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until && child) {
    const info = await checkServerVersion();
    if (info?.version) return info;
    await new Promise((r) => setTimeout(r, 700));
  }
  return null;
}

/**
 * @param {{ webDir: string, dataDir: string, version: string }} opts
 */
async function startWebServer(opts) {
  if (child) return status;
  stopping = false;
  const serverJs = path.join(opts.webDir, "server.js");
  if (!fs.existsSync(serverJs)) {
    setStatus({ state: "error", message: `No se encontró el servidor de B-POS (${serverJs}). Usa "Reparar instalación".` });
    return status;
  }

  // Si B-POS se cerró de golpe, su servidor anterior pudo quedar vivo
  const pidFile = path.join(opts.dataDir, "..", "server.pid");
  try {
    const oldPid = Number(fs.readFileSync(pidFile, "utf8"));
    // Solo si el puerto lo tiene un B-POS de escritorio (el pid pudo reutilizarse)
    if (oldPid > 0 && (await checkServerVersion())?.desktop) {
      process.kill(oldPid);
      console.warn(`Se cerró un servidor de B-POS que había quedado abierto (pid ${oldPid}).`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  } catch {
    // no había servidor anterior
  }
  try { fs.rmSync(pidFile, { force: true }); } catch {}

  if (await portInUse(PORT)) {
    const info = await checkServerVersion();
    setStatus({
      state: "error",
      message: info?.version
        ? `El puerto ${PORT} ya lo usa otro B-POS (v${info.version}). Cierra INICIAR-BPOS u otra copia y toca "Reiniciar servidor".`
        : `El puerto ${PORT} está ocupado por otro programa. Ciérralo y toca "Reiniciar servidor".`,
    });
    return status;
  }

  // La carpeta de datos del Bridge empieza con los archivos que trae el build
  fs.mkdirSync(opts.dataDir, { recursive: true });
  const seedDir = path.join(opts.webDir, "data");
  if (fs.existsSync(seedDir)) {
    for (const name of fs.readdirSync(seedDir).filter((n) => n.endsWith(".json"))) {
      const target = path.join(opts.dataDir, name);
      if (!fs.existsSync(target)) fs.copyFileSync(path.join(seedDir, name), target);
    }
  }

  setStatus({ state: "starting", message: "Arrancando B-POS...", version: null });
  child = spawn(process.execPath, [serverJs], {
    cwd: opts.webDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(PORT),
      HOSTNAME: "0.0.0.0",
      BPOS_DATA_DIR: opts.dataDir,
      BPOS_APP_VERSION: opts.version,
      // El Agent de esta app manda su llave; no se aceptan Agents sin llave
      BPOS_REQUIRE_AGENT_KEY: "1",
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  setStatus({ pid: child.pid });
  try { fs.writeFileSync(pidFile, String(child.pid)); } catch {}
  child.stdout.on("data", (c) => logLines("servidor", "info", c));
  child.stderr.on("data", (c) => logLines("servidor", "error", c));

  child.on("exit", (code, signal) => {
    child = null;
    try { fs.rmSync(pidFile, { force: true }); } catch {}
    if (stopping) {
      setStatus({ state: "stopped", message: "Detenido", pid: null });
      return;
    }
    restarts += 1;
    const wait = Math.min(30000, 1000 * 2 ** Math.min(restarts, 5));
    console.error(`El servidor de B-POS se detuvo (código ${code}, señal ${signal}). Reintento en ${wait / 1000} s.`);
    setStatus({ state: "error", message: `El servidor se detuvo; reintentando en ${Math.round(wait / 1000)} s...`, pid: null });
    restartTimer = setTimeout(() => startWebServer(opts), wait);
  });

  const info = await waitUntilReady();
  if (info?.version) {
    restarts = 0;
    setStatus({ state: "running", message: `Funcionando en el puerto ${PORT}`, version: info.version });
  } else if (child) {
    setStatus({ state: "error", message: "B-POS tarda en responder. Revisa el log." });
  }
  return status;
}

function stopWebServer() {
  stopping = true;
  clearTimeout(restartTimer);
  if (!child) return Promise.resolve();
  const proc = child;
  return new Promise((resolve) => {
    const done = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      resolve();
    }, 5000);
    proc.once("exit", () => { clearTimeout(done); resolve(); });
    try { proc.kill(); } catch { resolve(); }
  });
}

async function restartWebServer(opts) {
  await stopWebServer();
  restarts = 0;
  return startWebServer(opts);
}

module.exports = { PORT, startWebServer, stopWebServer, restartWebServer, checkServerVersion, onStatus, getStatus: () => status };
