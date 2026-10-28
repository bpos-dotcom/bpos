// Bloque 13 · Log de errores.
// Guarda todo lo que pasa (console.log/error de la app y del servidor de
// B-POS) en %APPDATA%/B-POS/logs/bpos.log. Al pasar de 5 MB lo rota y
// conserva los últimos 5 archivos.
const fs = require("fs");
const path = require("path");
const util = require("util");

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP = 5;

let logDir = null;
let logFile = null;

function rotate() {
  try {
    if (!fs.existsSync(logFile) || fs.statSync(logFile).size < MAX_BYTES) return;
    for (let i = KEEP - 1; i >= 1; i -= 1) {
      const from = `${logFile}.${i}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${logFile}.${i + 1}`);
    }
    fs.renameSync(logFile, `${logFile}.1`);
    const oldest = `${logFile}.${KEEP + 1}`;
    if (fs.existsSync(oldest)) fs.rmSync(oldest);
  } catch {
    // si no se puede rotar, se sigue escribiendo en el mismo archivo
  }
}

function write(level, source, args) {
  if (!logFile) return;
  const text = args.map((a) => (typeof a === "string" ? a : util.inspect(a, { depth: 4 }))).join(" ");
  const line = `${new Date().toISOString()} [${level}] [${source}] ${text}\n`;
  try {
    rotate();
    fs.appendFileSync(logFile, line);
  } catch {
    // sin disco no hay log; no detener la app por esto
  }
}

/** Empieza a guardar el log y redirige console.* al archivo. */
function initLogger(baseDir) {
  logDir = path.join(baseDir, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  logFile = path.join(logDir, "bpos.log");

  const original = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  console.log = (...a) => { original.log(...a); write("info", "app", a); };
  console.info = (...a) => { original.info(...a); write("info", "app", a); };
  console.warn = (...a) => { original.warn(...a); write("warn", "app", a); };
  console.error = (...a) => { original.error(...a); write("error", "app", a); };

  process.on("uncaughtException", (error) => write("error", "app", ["Error no controlado:", error]));
  process.on("unhandledRejection", (error) => write("error", "app", ["Promesa rechazada sin controlar:", error]));
  return logFile;
}

/** Para el texto que imprime el servidor de B-POS (otro proceso). */
function logLines(source, level, chunk) {
  String(chunk)
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .forEach((l) => write(level, source, [l]));
}

/** Últimas líneas del log (para la ventana de estado). */
function tailLog(lines = 200) {
  try {
    const text = fs.readFileSync(logFile, "utf8");
    return text.split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

module.exports = { initLogger, logLines, tailLog, getLogDir: () => logDir, getLogFile: () => logFile };
