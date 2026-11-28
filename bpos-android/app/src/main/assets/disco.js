// B-POS Dueño (Android): antes de que cargue B-POS, su localStorage se cambia
// por uno guardado en el teléfono (DiscoBpos.kt). Es lo mismo que hace la caja
// local del Agent en Windows (bpos-agent/caja-preload.js): B-POS no cambia,
// sigue llamando localStorage.getItem/setItem, pero ya no hay tope de ~5 MB.
(function () {
  if (window.bposCajaLocal || typeof BposDisco === "undefined") return;
  var data;
  try {
    data = new Map(Object.entries(JSON.parse(BposDisco.cargar())));
  } catch (e) {
    return; // sin disco: se queda el del navegador
  }
  class DiskStorage {
    getItem(key) {
      key = String(key);
      return data.has(key) ? data.get(key) : null;
    }
    setItem(key, value) {
      key = String(key);
      value = String(value);
      data.set(key, value);
      BposDisco.guardar(key, value);
    }
    removeItem(key) {
      key = String(key);
      if (!data.has(key)) return;
      data.delete(key);
      BposDisco.borrar(key);
    }
    clear() {
      data.clear();
      BposDisco.vaciar();
    }
    key(index) {
      var keys = Array.from(data.keys());
      return index >= 0 && index < keys.length ? keys[index] : null;
    }
    get length() {
      return data.size;
    }
  }
  var storage = new DiskStorage();
  Object.defineProperty(window, "localStorage", { configurable: true, enumerable: true, get: function () { return storage; } });
  Object.defineProperty(window, "bposCajaLocal", { value: Object.freeze({ version: 1, kind: "android" }) });
})();
