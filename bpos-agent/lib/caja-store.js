// Caja local: lo que B-POS guardaba en la memoria del navegador (localStorage,
// 5-10 MB y se llenaba) se guarda en el disco de esta computadora.
//
// Un archivo por llave (el nombre es la llave en hexadecimal: Windows no
// distingue mayúsculas y no acepta * ? : en nombres). Se escribe a un
// archivo temporal y luego se renombra, para que un apagón no deje un
// archivo a medias. Las escrituras esperan un momento (WRITE_DELAY_MS) para
// juntar cambios seguidos; al cerrar se escribe todo lo pendiente.
const fs = require("fs");
const path = require("path");

const WRITE_DELAY_MS = 250;
const EXT = ".txt";

function fileOf(dir, key) {
  return path.join(dir, Buffer.from(String(key), "utf8").toString("hex") + EXT);
}

function keyOf(name) {
  if (!name.endsWith(EXT)) return null;
  const hex = name.slice(0, -EXT.length);
  if (!/^([0-9a-f]{2})+$/.test(hex)) return null;
  return Buffer.from(hex, "hex").toString("utf8");
}

function writeAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, value, "utf8");
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Windows a veces no deja renombrar encima (antivirus): se escribe directo
    fs.writeFileSync(file, value, "utf8");
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
}

function createCajaStore(dir, { delayMs = WRITE_DELAY_MS } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  /** llave → valor (string) o null = borrar */
  const pending = new Map();
  let timer = null;

  function load() {
    const out = {};
    for (const name of fs.readdirSync(dir)) {
      const key = keyOf(name);
      if (key === null) continue;
      try {
        out[key] = fs.readFileSync(path.join(dir, name), "utf8");
      } catch (error) {
        console.error(`Caja local: no se pudo leer ${key}: ${error.message}`);
      }
    }
    // Lo que todavía no se escribe también cuenta
    for (const [key, value] of pending) {
      if (value === null) delete out[key];
      else out[key] = value;
    }
    return out;
  }

  function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    const items = [...pending];
    pending.clear();
    for (const [key, value] of items) {
      const file = fileOf(dir, key);
      try {
        if (value === null) {
          if (fs.existsSync(file)) fs.unlinkSync(file);
        } else writeAtomic(file, value);
      } catch (error) {
        console.error(`Caja local: no se pudo guardar ${key}: ${error.message}`);
        if (!pending.has(key)) pending.set(key, value); // se reintenta en la próxima
      }
    }
    if (pending.size) schedule();
  }

  function schedule() {
    if (!timer) timer = setTimeout(flush, delayMs);
  }

  function set(key, value) {
    pending.set(String(key), String(value));
    schedule();
  }

  function remove(key) {
    pending.set(String(key), null);
    schedule();
  }

  function clear() {
    pending.clear();
    for (const name of fs.readdirSync(dir)) {
      if (keyOf(name) !== null) pending.set(keyOf(name), null);
    }
    flush();
  }

  function hasData() {
    return Object.keys(load()).length > 0;
  }

  /** Reemplaza todo con lo que traía el navegador */
  function replaceAll(entries) {
    clear();
    for (const [key, value] of Object.entries(entries || {})) {
      if (typeof value === "string") pending.set(String(key), value);
    }
    flush();
  }

  return { load, set, remove, clear, flush, hasData, replaceAll, dir };
}

module.exports = { createCajaStore, fileOf, keyOf };
