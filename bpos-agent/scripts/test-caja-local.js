// Prueba real de la caja local en Electron (sin B-POS): una página de prueba
// en http://localhost:3200 usa localStorage como lo hace B-POS.
//   cd bpos-agent && npx electron scripts/test-caja-local.js
const { app, BrowserWindow } = require("electron");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "bpos-caja-test-"));
app.setPath("userData", profile);
process.env.BPOS_CAJA_URL = "http://localhost:3200";
const caja = require("../lib/caja-local");
const { createCajaStore } = require("../lib/caja-store");

let ok = 0;
let bad = 0;
const check = (name, cond, extra) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

const PAGE = `<!doctype html><html><body><script>
  window.results = {};
  const r = window.results;
  r.isDisk = localStorage.constructor.name === "DiskStorage";
  r.flag = !!window.bposCajaLocal;
  r.before = localStorage.getItem("bpos_seed");
  // Como lib/cloud/sync.ts: se engancha al prototipo
  const proto = Object.getPrototypeOf(localStorage);
  const originalSet = proto.setItem;
  window.dirty = [];
  proto.setItem = function (k, v) { originalSet.call(this, k, v); if (this === window.localStorage) window.dirty.push(k); };
  localStorage.setItem("bpos_orders", "x".repeat(12 * 1024 * 1024)); // 12 MB: el navegador no deja
  r.bigLen = (localStorage.getItem("bpos_orders") || "").length;
  r.dirty = window.dirty.slice();
  localStorage.setItem("bpos_tmp", "1");
  localStorage.removeItem("bpos_tmp");
  r.removed = localStorage.getItem("bpos_tmp") === null;
  r.length = localStorage.length;
  r.keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
  try { new StorageEvent("storage", { key: "a", newValue: "b" }); r.event = true; } catch (e) { r.event = String(e); }
  window.addEventListener("storage", (e) => { r.remote = e.key + "=" + e.newValue; });
</script></body></html>`;
const CHILD = `<!doctype html><script>localStorage.setItem("bpos_from_child", "hola");</script>`;

const server = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  res.end(req.url.startsWith("/child") ? CHILD : PAGE);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function loaded(win) {
  if (win.webContents.isLoading()) await new Promise((r) => win.webContents.once("did-finish-load", r));
}

app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  await new Promise((r) => server.listen(3200, "127.0.0.1", r));
  caja.registerCajaIpc();

  // Importar lo del navegador
  const imp = caja.importEntries({ bpos_seed: "del chrome", bpos_device_id: "dev-1" });
  check("importa", imp.ok && imp.count === 2, imp);
  check("queda activada", caja.isEnabled());
  check("sin reemplazar no pisa", caja.importEntries({ a: "b" }).conflict === true);

  let win = caja.openCaja("/");
  await loaded(win);
  const r = await win.webContents.executeJavaScript("window.results");
  check("localStorage es el del disco", r.isDisk && r.flag, r);
  check("trae lo importado", r.before === "del chrome", r.before);
  check("12 MB sí caben", r.bigLen === 12 * 1024 * 1024, r.bigLen);
  check("el gancho de la sincronización ve el cambio", JSON.stringify(r.dirty) === JSON.stringify(["bpos_orders"]), r.dirty);
  check("borrar", r.removed);
  check("length y key()", r.length === 3 && r.keys.includes("bpos_device_id"), r.keys);
  check("StorageEvent sin storageArea", r.event === true, r.event);

  // Otra ventana de la caja: comparten datos y avisan
  await win.webContents.executeJavaScript(`window.open("/child", "_blank"); 1`);
  await wait(1500);
  const remote = await win.webContents.executeJavaScript("window.results.remote");
  check("la otra ventana avisa", remote === "bpos_from_child=hola", remote);
  const child = await win.webContents.executeJavaScript(`localStorage.getItem("bpos_from_child")`);
  check("y la principal lo tiene", child === "hola", child);

  // Ligas de fuera no se abren dentro
  const external = await win.webContents.executeJavaScript(`String(window.open("https://example.com", "_blank"))`);
  check("liga de fuera no abre ventana dentro", external === "null", external);

  // Se cierra y se guarda en disco
  BrowserWindow.getAllWindows().forEach((w) => w.destroy());
  await wait(300);
  caja.flushCaja();
  const disk = createCajaStore(path.join(profile, "caja-local")).load();
  check("en disco: 12 MB", (disk.bpos_orders || "").length === 12 * 1024 * 1024);
  check("en disco: sin lo borrado", !("bpos_tmp" in disk));
  check("en disco: lo de la otra ventana", disk.bpos_from_child === "hola");

  // Reabrir: sigue ahí
  win = caja.openCaja("/");
  await loaded(win);
  const again = await win.webContents.executeJavaScript(`[localStorage.getItem("bpos_seed"), (localStorage.getItem("bpos_orders")||"").length]`);
  check("al reabrir sigue todo", again[0] === "del chrome" && again[1] === 12 * 1024 * 1024, again);

  // Reemplazar
  const rep = caja.importEntries({ bpos_seed: "nuevo" }, { replace: true });
  const after = createCajaStore(path.join(profile, "caja-local")).load();
  check("reemplazar deja solo lo nuevo", rep.ok && Object.keys(after).length === 1 && after.bpos_seed === "nuevo", Object.keys(after));

  console.log(`\n${ok} bien, ${bad} mal`);
  BrowserWindow.getAllWindows().forEach((w) => w.destroy());
  server.close();
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(bad ? 1 : 0);
});
