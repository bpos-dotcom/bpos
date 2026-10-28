// Bloque 13 · Actualizador automático y verificación de versión.
// Revisa las versiones publicadas en GitHub Releases (bpos-dotcom/bpos),
// descarga la nueva en segundo plano y la instala al cerrar B-POS o
// cuando el usuario toca "Reiniciar y actualizar".
const { autoUpdater } = require("electron-updater");

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const listeners = new Set();
let status = { state: "idle", message: "Sin revisar", available: null, progress: null, checkedAt: null };

function setStatus(patch) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l(status));
}

function onUpdateStatus(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function initUpdater({ isPackaged }) {
  autoUpdater.logger = { info: console.log, warn: console.warn, error: console.error, debug: () => {} };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => setStatus({ state: "checking", message: "Buscando actualizaciones..." }));
  autoUpdater.on("update-not-available", () =>
    setStatus({ state: "current", message: "Tienes la versión más reciente", available: null, checkedAt: new Date().toISOString() })
  );
  autoUpdater.on("update-available", (info) =>
    setStatus({ state: "downloading", message: `Descargando la versión ${info.version}...`, available: info.version, progress: 0 })
  );
  autoUpdater.on("download-progress", (p) =>
    setStatus({ progress: Math.round(p.percent), message: `Descargando ${status.available || "actualización"}: ${Math.round(p.percent)}%` })
  );
  autoUpdater.on("update-downloaded", (info) =>
    setStatus({ state: "ready", message: `Versión ${info.version} lista. Se instala al cerrar B-POS.`, available: info.version, progress: 100 })
  );
  autoUpdater.on("error", (error) =>
    setStatus({ state: "error", message: `No se pudo buscar actualizaciones: ${error?.message || error}`, checkedAt: new Date().toISOString() })
  );

  if (!isPackaged) {
    setStatus({ state: "dev", message: "Modo desarrollo: el actualizador solo funciona en la app instalada." });
    return;
  }
  setTimeout(checkForUpdates, 20_000);
  setInterval(checkForUpdates, CHECK_EVERY_MS);
}

function checkForUpdates() {
  if (status.state === "dev" || status.state === "downloading" || status.state === "ready") return Promise.resolve(status);
  return autoUpdater.checkForUpdates().then(() => status).catch(() => status);
}

/** Cierra B-POS, instala la versión descargada y la vuelve a abrir. */
function installNow() {
  if (status.state !== "ready") return false;
  autoUpdater.quitAndInstall(true, true);
  return true;
}

module.exports = { initUpdater, checkForUpdates, installNow, onUpdateStatus, getUpdateStatus: () => status };
