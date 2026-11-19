// Caja local (lib/caja-local.js): antes de que cargue B-POS, su localStorage
// se cambia por uno guardado en el disco. B-POS no cambia: sigue llamando
// localStorage.getItem/setItem; la sincronización (lib/cloud/sync.ts) se
// engancha al prototipo de este mismo objeto.
const { contextBridge, ipcRenderer } = require("electron");

const ORIGINS = ["https://www.bpos.com.mx", "https://bpos.com.mx", "http://localhost:3200", "http://127.0.0.1:3200", "http://localhost:3000"];

if (ORIGINS.includes(location.origin)) {
  const initial = ipcRenderer.sendSync("caja:load");
  if (initial && typeof initial === "object") {
    let onRemote = null;
    ipcRenderer.on("caja:changed", (_event, change) => {
      if (onRemote) onRemote(change);
    });
    contextBridge.executeInMainWorld({
      func: (initialData, api) => {
        const data = new Map(Object.entries(initialData));
        class DiskStorage {
          getItem(key) {
            key = String(key);
            return data.has(key) ? data.get(key) : null;
          }
          setItem(key, value) {
            key = String(key);
            value = String(value);
            data.set(key, value);
            api.set(key, value);
          }
          removeItem(key) {
            key = String(key);
            if (!data.has(key)) return;
            data.delete(key);
            api.remove(key);
          }
          clear() {
            data.clear();
            api.clear();
          }
          key(index) {
            const keys = [...data.keys()];
            return index >= 0 && index < keys.length ? keys[index] : null;
          }
          get length() {
            return data.size;
          }
        }
        const storage = new DiskStorage();
        Object.defineProperty(window, "localStorage", { configurable: true, enumerable: true, get: () => storage });
        Object.defineProperty(window, "bposCajaLocal", { value: Object.freeze({ version: 1 }) });
        // Lo que cambia otra ventana de la caja (ej. la de inventario ciego)
        api.onRemote((change) => {
          const key = change.type === "clear" ? null : change.key;
          const oldValue = key === null ? null : data.has(key) ? data.get(key) : null;
          if (change.type === "set") data.set(change.key, change.value);
          else if (change.type === "remove") data.delete(change.key);
          else data.clear();
          window.dispatchEvent(new StorageEvent("storage", { key, oldValue, newValue: change.type === "set" ? change.value : null, url: location.href }));
        });
      },
      args: [
        initial,
        {
          set: (key, value) => ipcRenderer.send("caja:set", key, value),
          remove: (key) => ipcRenderer.send("caja:remove", key),
          clear: () => ipcRenderer.send("caja:clear"),
          onRemote: (fn) => {
            onRemote = fn;
          },
        },
      ],
    });
  }
}
