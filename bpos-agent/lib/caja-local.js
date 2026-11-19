// Caja local: B-POS abierto en una ventana propia del Agent (no en Chrome).
// Es la misma página de www.bpos.com.mx (se actualiza sola y funciona sin
// internet con su service worker), pero lo que guardaba en la memoria del
// navegador vive en el disco (lib/caja-store.js): ya no se llena y escribir
// el kardex o los pedidos no detiene la pantalla.
//
// Los datos del Chrome de la caja se pasan una vez desde B-POS
// (Configuración → Sistema → Caja local), por POST /caja-local/import.
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { createCajaStore } = require("./caja-store");

const DEFAULT_URL = "https://www.bpos.com.mx";
// Pruebas: BPOS_CAJA_URL=http://localhost:3200
const CAJA_URL = (process.env.BPOS_CAJA_URL || DEFAULT_URL).replace(/\/$/, "");
const CAJA_ORIGINS = new Set([new URL(CAJA_URL).origin, "https://www.bpos.com.mx", "https://bpos.com.mx"]);
const PARTITION = "persist:bpos-caja";

let store = null;
let mainWin = null;
let quitting = false;
app.on("before-quit", () => {
  quitting = true;
});
/** webContents de las ventanas de la caja (la principal y las que abre) */
const contents = new Set();

function dataDir() {
  return path.join(app.getPath("userData"), "caja-local");
}

function settingsFile() {
  return path.join(app.getPath("userData"), "caja-local.json");
}

function getStore() {
  if (!store) store = createCajaStore(dataDir());
  return store;
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), "utf8")) || {};
  } catch {
    return {};
  }
}

function writeSettings(next) {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify({ ...readSettings(), ...next }, null, 2));
  } catch (error) {
    console.error("Caja local: no se pudo guardar la configuración:", error.message);
  }
}

function isEnabled() {
  return readSettings().enabled === true;
}

function setEnabled(enabled) {
  writeSettings({ enabled: Boolean(enabled) });
}

function info() {
  return { version: 1, enabled: isEnabled(), hasData: getStore().hasData(), open: Boolean(mainWin && !mainWin.isDestroyed()) };
}

function isCajaOrigin(url) {
  try {
    return CAJA_ORIGINS.has(new URL(url).origin);
  } catch {
    return false;
  }
}

function webPreferences() {
  return {
    preload: path.join(__dirname, "..", "caja-preload.js"),
    partition: PARTITION,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    backgroundThrottling: false, // minimizada sigue procesando los pedidos de Uber/DiDi/Rappi
  };
}

function track(wc) {
  contents.add(wc);
  wc.once("destroyed", () => contents.delete(wc));
  // Ligas de fuera (Mercado Pago, WhatsApp, mapas): en el navegador
  wc.setWindowOpenHandler(({ url }) => {
    if (url === "about:blank" || url === "" || isCajaOrigin(url)) {
      return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: webPreferences() } };
    }
    if (/^(https?|mailto|tel|whatsapp):/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  wc.on("will-navigate", (event, url) => {
    if (isCajaOrigin(url)) return;
    event.preventDefault();
    if (/^(https?|mailto|tel|whatsapp):/i.test(url)) void shell.openExternal(url);
  });
  wc.on("did-create-window", (child) => track(child.webContents));
}

function openCaja(route = "/inicio") {
  if (!app.isReady()) {
    void app.whenReady().then(() => openCaja(route));
    return null;
  }
  const target = `${CAJA_URL}${typeof route === "string" && route.startsWith("/") ? route : "/inicio"}`;
  if (mainWin && !mainWin.isDestroyed()) {
    if (route && route !== "/inicio") void mainWin.loadURL(target);
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
    return mainWin;
  }
  mainWin = new BrowserWindow({
    width: 1366,
    height: 860,
    title: "B-POS",
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#000000",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: webPreferences(),
  });
  track(mainWin.webContents);
  mainWin.once("ready-to-show", () => {
    mainWin.maximize();
    mainWin.show();
  });
  mainWin.on("close", (event) => {
    if (quitting) return;
    const choice = dialog.showMessageBoxSync(mainWin, {
      type: "question",
      buttons: ["Cerrar la caja", "Cancelar"],
      defaultId: 1,
      cancelId: 1,
      title: "Cerrar la caja",
      message: "¿Cerrar la caja de B-POS?",
      detail: "Mientras esté cerrada no se procesan solos los pedidos de Uber, DiDi y Rappi. Lo guardado no se pierde.",
    });
    if (choice !== 0) event.preventDefault();
  });
  mainWin.on("closed", () => {
    mainWin = null;
    getStore().flush();
  });
  void mainWin.loadURL(target);
  return mainWin;
}

/** Datos del Chrome de la caja → disco. replace=false y ya hay datos: no se toca */
function importEntries(entries, { replace = false } = {}) {
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw new Error("Datos inválidos.");
  const s = getStore();
  if (s.hasData() && !replace) return { ok: false, conflict: true };
  const count = Object.values(entries).filter((v) => typeof v === "string").length;
  // Si la caja está abierta se cierra antes de reemplazar (no debe seguir con los datos viejos)
  if (mainWin && !mainWin.isDestroyed()) mainWin.destroy();
  s.replaceAll(entries);
  writeSettings({ enabled: true, importedAt: new Date().toISOString(), importedKeys: count });
  console.log(`Caja local: se pasaron ${count} llaves del navegador`);
  return { ok: true, count };
}

function fromCaja(event) {
  return contents.has(event.sender) && isCajaOrigin(event.senderFrame?.url || event.sender.getURL());
}

function broadcastChange(sender, change) {
  for (const wc of contents) {
    if (wc !== sender && !wc.isDestroyed()) wc.send("caja:changed", change);
  }
}

function registerCajaIpc() {
  ipcMain.on("caja:load", (event) => {
    event.returnValue = fromCaja(event) ? getStore().load() : null;
  });
  ipcMain.on("caja:set", (event, key, value) => {
    if (!fromCaja(event) || typeof key !== "string" || typeof value !== "string") return;
    getStore().set(key, value);
    broadcastChange(event.sender, { type: "set", key, value });
  });
  ipcMain.on("caja:remove", (event, key) => {
    if (!fromCaja(event) || typeof key !== "string") return;
    getStore().remove(key);
    broadcastChange(event.sender, { type: "remove", key });
  });
  ipcMain.on("caja:clear", (event) => {
    if (!fromCaja(event)) return;
    getStore().clear();
    broadcastChange(event.sender, { type: "clear" });
  });
}

function flushCaja() {
  if (store) store.flush();
}

module.exports = { openCaja, importEntries, registerCajaIpc, flushCaja, isEnabled, setEnabled, info, CAJA_URL };
