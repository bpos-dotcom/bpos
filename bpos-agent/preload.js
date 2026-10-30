const { contextBridge, ipcRenderer } = require("electron");

// Lo único que la ventana de estado puede pedirle a la app (lib/desktop.js)
contextBridge.exposeInMainWorld("bpos", {
  getState: () => ipcRenderer.invoke("bpos:get-state"),
  onState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on("bpos:state", handler);
    return () => ipcRenderer.removeListener("bpos:state", handler);
  },
  open: (route) => ipcRenderer.invoke("bpos:open", route),
  checkUpdates: () => ipcRenderer.invoke("bpos:check-updates"),
  installUpdate: () => ipcRenderer.invoke("bpos:install-update"),
  pair: (code) => ipcRenderer.invoke("bpos:pair", code),
  unlink: () => ipcRenderer.invoke("bpos:unlink"),
  repair: () => ipcRenderer.invoke("bpos:repair"),
  openLogs: () => ipcRenderer.invoke("bpos:open-logs"),
  tailLog: () => ipcRenderer.invoke("bpos:tail-log"),
  setAutoStart: (enabled) => ipcRenderer.invoke("bpos:set-autostart", enabled),
});
