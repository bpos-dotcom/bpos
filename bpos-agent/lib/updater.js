// Bloque 13 · Actualizador automático y verificación de versión.
// Revisa las versiones publicadas en GitHub Releases (bpos-dotcom/bpos),
// descarga la nueva en segundo plano y la instala al cerrar B-POS o
// cuando el usuario toca "Reiniciar y actualizar".
const { autoUpdater } = require("electron-updater");

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const listeners = new Set();
let status = { state: "idle", message: "Sin revisar", available: null, progress: null, checkedAt: null };

function setStatus(patch) {
  // En el registro solo el mensaje en español (sin el detalle técnico del actualizador)
  if (patch.message && patch.message !== status.message && patch.progress == null) console.log(`[actualizaciones] ${patch.message}`);
  status = { ...status, ...patch };
  listeners.forEach((l) => l(status));
}

function onUpdateStatus(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function initUpdater({ isPackaged }) {
  // El detalle técnico (direcciones de descarga) no va al registro que ve el cliente
  autoUpdater.logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
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
  autoUpdater.on("update-downloaded", (info) => {
    setStatus({ state: "ready", message: `Versión ${info.version} lista. Se instala al cerrar B-POS o sola en la madrugada.`, available: info.version, progress: 100 });
    scheduleNightInstall();
  });
  autoUpdater.on("error", (error) => {
    const text = String(error?.message || error);
    // Sin releases publicados GitHub contesta 404: no es una falla
    const noReleases = /404|Unable to find latest version|No published versions/i.test(text);
    const offline = /ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|net::ERR/i.test(text);
    setStatus({
      state: noReleases ? "current" : "error",
      message: noReleases
        ? "Aún no hay versiones publicadas"
        : offline
          ? "Sin internet: se vuelve a revisar más tarde"
          : `No se pudo buscar actualizaciones: ${text.split("\n")[0].slice(0, 160)}`,
      checkedAt: new Date().toISOString(),
    });
  });

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

/**
 * El Agent casi nunca se cierra, así que la versión descargada se quedaba sin
 * instalar (y seguían los errores ya corregidos). Se instala sola en la
 * madrugada (3 a 6 a.m., hora de la PC), cuando no hay servicio, y se vuelve a abrir.
 */
const NIGHT_FROM = 3;
const NIGHT_TO = 6;
let nightTimer = null;
function isNight(date = new Date()) {
  const h = date.getHours();
  return h >= NIGHT_FROM && h < NIGHT_TO;
}
function scheduleNightInstall() {
  if (nightTimer) return;
  nightTimer = setInterval(() => {
    if (status.state === "ready" && isNight()) {
      console.log("[actualizaciones] Instalando la versión nueva (madrugada)...");
      clearInterval(nightTimer);
      nightTimer = null;
      autoUpdater.quitAndInstall(true, true);
    }
  }, 10 * 60 * 1000);
}

/** Cierra B-POS, instala la versión descargada y la vuelve a abrir. */
function installNow() {
  if (status.state !== "ready") return false;
  autoUpdater.quitAndInstall(true, true);
  return true;
}

module.exports = { isNight, initUpdater, checkForUpdates, installNow, onUpdateStatus, getUpdateStatus: () => status };
