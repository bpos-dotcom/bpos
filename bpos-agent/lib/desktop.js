// Bloque 13 · App de escritorio de B-POS.
// Arranca con Windows y vive en la bandeja (junto al reloj): levanta el
// servidor de B-POS, el Agent de impresión, el actualizador, y muestra una
// ventana de estado. Cerrar la ventana no detiene nada; "Salir" sí.
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell, dialog } = require("electron");
const path = require("path");
const { getLogDir, getLogFile, tailLog } = require("./logger");
const web = require("./web-server");
const updater = require("./updater");
const { repairInstallation } = require("./repair");

let win = null;
let tray = null;
let quitting = false;
let lastRepair = null;

function paths() {
  const resourcesDir = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
  return {
    resourcesDir,
    // En desarrollo usa la copia que deja `npm run desktop:prepare`
    webDir: path.join(resourcesDir, "web"),
    dataDir: path.join(app.getPath("userData"), "data"),
    iconPath: path.join(__dirname, "..", "build", "icon.png"),
  };
}

function serverOpts() {
  const p = paths();
  return { webDir: p.webDir, dataDir: p.dataDir, version: app.getVersion() };
}

function setAutoStart() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: true, args: ["--hidden"] });
}

function openBpos(route = "/") {
  return shell.openExternal(`http://localhost:${web.PORT}${route}`);
}

function state() {
  return {
    appVersion: app.getVersion(),
    server: web.getStatus(),
    update: updater.getUpdateStatus(),
    autoStart: app.isPackaged ? app.getLoginItemSettings().openAtLogin : false,
    packaged: app.isPackaged,
    logFile: getLogFile(),
    agent: { port: 4850, printerPort: 9100 },
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
    height: 640,
    title: "B-POS",
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#050505",
    icon: paths().iconPath,
    webPreferences: { preload: path.join(__dirname, "..", "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, "..", "index.html"));
  // Cerrar la ventana solo la esconde: B-POS sigue funcionando en la bandeja
  win.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
}

function refreshTray() {
  if (!tray) return;
  const s = web.getStatus();
  const u = updater.getUpdateStatus();
  tray.setToolTip(`B-POS ${app.getVersion()} · ${s.message}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Abrir B-POS", click: () => openBpos("/") },
      { label: "App del dueño", click: () => openBpos("/dueno") },
      { label: "Ver estado", click: showWindow },
      { type: "separator" },
      u.state === "ready"
        ? { label: `Reiniciar y actualizar a ${u.available}`, click: () => updater.installNow() }
        : { label: "Buscar actualizaciones", click: () => updater.checkForUpdates() },
      { label: "Reiniciar servidor", click: () => web.restartWebServer(serverOpts()) },
      { label: "Reparar instalación", click: runRepair },
      { label: "Abrir carpeta de registros", click: () => shell.openPath(getLogDir()) },
      { type: "separator" },
      { label: "Salir de B-POS", click: confirmQuit },
    ])
  );
}

async function runRepair() {
  showWindow();
  lastRepair = { running: true, steps: [] };
  broadcast();
  const steps = await repairInstallation({
    resourcesDir: paths().resourcesDir,
    webDir: paths().webDir,
    setAutoStart,
    restartServer: () => web.restartWebServer(serverOpts()),
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
    title: "Salir de B-POS",
    message: "¿Salir de B-POS?",
    detail: "Las cajas, la cocina y los celulares dejarán de conectarse a esta computadora hasta que vuelvas a abrir B-POS.",
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
  ipcMain.handle("bpos:restart-server", () => web.restartWebServer(serverOpts()));
  ipcMain.handle("bpos:repair", () => runRepair());
  ipcMain.handle("bpos:open-logs", () => shell.openPath(getLogDir()));
  ipcMain.handle("bpos:tail-log", () => tailLog(150));
  ipcMain.handle("bpos:set-autostart", (_e, enabled) => {
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: Boolean(enabled), args: ["--hidden"] });
    broadcast();
    return state();
  });
}

function startDesktop({ onQuit }) {
  // Mismo id que appId del instalador: nombra el inicio automático en el
  // registro (el desinstalador lo borra por este nombre) y las notificaciones
  app.setAppUserModelId("com.burgerplanet.bposagent");
  app.on("second-instance", showWindow);
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", async (event) => {
    if (web.getStatus().state === "stopped") return;
    event.preventDefault();
    await web.stopWebServer();
    await onQuit?.();
    // quit (no exit) para que el actualizador pueda instalar al cerrar
    app.quit();
  });
  // B-POS vive en la bandeja aunque no haya ventanas
  app.on("window-all-closed", () => {});

  app.whenReady().then(() => {
    console.log(`B-POS ${app.getVersion()} iniciando (${app.isPackaged ? "instalado" : "desarrollo"})`);
    registerIpc();
    createWindow();

    const icon = nativeImage.createFromPath(paths().iconPath);
    tray = new Tray(icon.isEmpty() ? icon : icon.resize({ width: 16, height: 16 }));
    tray.on("double-click", showWindow);
    refreshTray();

    setAutoStart();
    web.onStatus(broadcast);
    updater.onUpdateStatus(broadcast);
    updater.initUpdater({ isPackaged: app.isPackaged });

    const hidden = process.argv.includes("--hidden");
    if (!hidden) win.once("ready-to-show", () => win.show());

    web.startWebServer(serverOpts()).then((s) => {
      // La primera vez (no al arrancar con Windows) se abre B-POS en el navegador
      if (s.state === "running" && !hidden) openBpos("/");
    });
  });
}

module.exports = { startDesktop };
