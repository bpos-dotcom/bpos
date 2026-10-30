// B-POS 2.0 · App de escritorio de B-POS Agent.
// B-POS se usa en la web; esta app arranca con Windows y vive en la bandeja
// (junto al reloj): lee los tickets de Rappi/Uber/DiDi, imprime lo que mandan
// las pantallas (lib/cloud-link.js), se actualiza sola y muestra una ventana
// de estado. Cerrar la ventana no detiene nada; "Salir" sí.
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell, dialog } = require("electron");
const path = require("path");
const { getLogDir, getLogFile, tailLog } = require("./logger");
const updater = require("./updater");
const cloudLink = require("./cloud-link");
const { repairInstallation } = require("./repair");

let win = null;
let tray = null;
let quitting = false;
let lastRepair = null;

function paths() {
  const resourcesDir = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
  return {
    resourcesDir,
    // Misma carpeta que B-POS 1.x: ahí están las equivalencias que se suben a la nube
    dataDir: path.join(app.getPath("userData"), "data"),
    iconPath: path.join(__dirname, "..", "build", "icon.png"),
  };
}

function setAutoStart() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: true, args: ["--hidden"] });
}

function openBpos(route = "/") {
  return shell.openExternal(`${cloudLink.WEB_URL}${route}`);
}

function state() {
  return {
    appVersion: app.getVersion(),
    cloud: cloudLink.getStatus(),
    webUrl: cloudLink.WEB_URL,
    update: updater.getUpdateStatus(),
    // Con los mismos args que setAutoStart, si no Windows no lo reconoce como el mismo registro
    autoStart: app.isPackaged ? app.getLoginItemSettings({ args: ["--hidden"] }).openAtLogin : false,
    packaged: app.isPackaged,
    logFile: getLogFile(),
    agent: { printerPort: 9100 },
    lastRepair,
  };
}

function broadcast() {
  if (win && !win.isDestroyed()) win.webContents.send("bpos:state", state());
  refreshTray();
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 760,
    height: 680,
    title: "B-POS Agent",
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#050505",
    icon: paths().iconPath,
    webPreferences: { preload: path.join(__dirname, "..", "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, "..", "index.html"));
  // Cerrar la ventana solo la esconde: el Agent sigue funcionando en la bandeja
  win.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
}

function refreshTray() {
  if (!tray) return;
  const c = cloudLink.getStatus();
  const u = updater.getUpdateStatus();
  tray.setToolTip(`B-POS Agent ${app.getVersion()} · ${c.message}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Abrir B-POS", click: () => openBpos("/") },
      { label: "Ver estado", click: showWindow },
      { type: "separator" },
      u.state === "ready"
        ? { label: `Reiniciar y actualizar a ${u.available}`, click: () => updater.installNow() }
        : { label: "Buscar actualizaciones", click: () => updater.checkForUpdates() },
      { label: "Reparar instalación", click: runRepair },
      { label: "Abrir carpeta de registros", click: () => shell.openPath(getLogDir()) },
      { type: "separator" },
      { label: "Salir de B-POS Agent", click: confirmQuit },
    ])
  );
}

async function runRepair() {
  showWindow();
  lastRepair = { running: true, steps: [] };
  broadcast();
  const steps = await repairInstallation({
    resourcesDir: paths().resourcesDir,
    setAutoStart,
    cloudStatus: () => cloudLink.getStatus(),
  });
  lastRepair = { running: false, steps, at: new Date().toISOString() };
  broadcast();
  return lastRepair;
}

async function confirmQuit() {
  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: ["Salir", "Cancelar"],
    defaultId: 1,
    cancelId: 1,
    title: "Salir de B-POS Agent",
    message: "¿Salir de B-POS Agent?",
    detail: "Mientras esté cerrado no se imprime nada ni llegan los pedidos de Rappi, Uber Eats y DiDi Food a B-POS.",
  });
  if (response === 0) {
    quitting = true;
    app.quit();
  }
}

function registerIpc() {
  ipcMain.handle("bpos:get-state", () => state());
  ipcMain.handle("bpos:open", (_e, route) => openBpos(typeof route === "string" && route.startsWith("/") ? route : "/"));
  ipcMain.handle("bpos:check-updates", () => updater.checkForUpdates());
  ipcMain.handle("bpos:install-update", () => updater.installNow());
  ipcMain.handle("bpos:repair", () => runRepair());
  ipcMain.handle("bpos:open-logs", () => shell.openPath(getLogDir()));
  ipcMain.handle("bpos:tail-log", () => tailLog(150));
  ipcMain.handle("bpos:pair", async (_e, code) => {
    try {
      await cloudLink.pair(code);
      broadcast();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: /inválido|vencido/i.test(error.message) ? "Código inválido o vencido. Pide uno nuevo en B-POS → Configuración → Sistema." : error.message };
    }
  });
  ipcMain.handle("bpos:unlink", async () => {
    const { response } = await dialog.showMessageBox(win, {
      type: "warning",
      buttons: ["Desvincular", "Cancelar"],
      defaultId: 1,
      cancelId: 1,
      title: "Desvincular",
      message: "¿Desvincular esta computadora de B-POS?",
      detail: "Dejará de imprimir y de mandar los pedidos de delivery hasta que escribas un código nuevo.",
    });
    if (response === 0) cloudLink.unlink();
    broadcast();
    return state();
  });
  ipcMain.handle("bpos:set-autostart", (_e, enabled) => {
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: Boolean(enabled), args: ["--hidden"] });
    broadcast();
    return state();
  });
}

/**
 * @param {{ onQuit?: () => Promise<void>, cloud: { handlers: object, listPrinters: () => Promise<any[]>, applyStationPrinters: (c: any) => void } }} opts
 */
function startDesktop({ onQuit, cloud }) {
  // Mismo id que appId del instalador: nombra el inicio automático en el
  // registro (el desinstalador lo borra por este nombre) y las notificaciones
  app.setAppUserModelId("com.burgerplanet.bposagent");
  app.on("second-instance", showWindow);
  app.on("before-quit", () => {
    quitting = true;
  });
  let cleaned = false;
  app.on("will-quit", async (event) => {
    if (cleaned) return;
    event.preventDefault();
    cleaned = true;
    cloudLink.stopCloudLink();
    await onQuit?.();
    // quit (no exit) para que el actualizador pueda instalar al cerrar
    app.quit();
  });
  // El Agent vive en la bandeja aunque no haya ventanas
  app.on("window-all-closed", () => {});

  app.whenReady().then(() => {
    console.log(`B-POS Agent ${app.getVersion()} iniciando (${app.isPackaged ? "instalado" : "desarrollo"})`);
    registerIpc();
    createWindow();

    const icon = nativeImage.createFromPath(paths().iconPath);
    tray = new Tray(icon.isEmpty() ? icon : icon.resize({ width: 16, height: 16 }));
    tray.on("double-click", showWindow);
    refreshTray();

    setAutoStart();
    updater.onUpdateStatus(broadcast);
    updater.initUpdater({ isPackaged: app.isPackaged });
    cloudLink.onStatus(broadcast);
    cloudLink.startCloudLink({ dataDir: paths().dataDir, version: app.getVersion(), ...cloud });

    const hidden = process.argv.includes("--hidden");
    // Sin vincular siempre se muestra la ventana: ahí se escribe el código
    if (!hidden || !cloudLink.getStatus().linked) win.once("ready-to-show", () => win.show());
    // La primera vez (no al arrancar con Windows) se abre B-POS en el navegador
    if (!hidden) void openBpos("/");
  });
}

module.exports = { startDesktop };
