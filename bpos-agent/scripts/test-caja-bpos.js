// B-POS de verdad en la ventana de la caja local. Necesita B-POS corriendo
// en http://localhost:3200 (NEXT_PUBLIC_BPOS_LOCAL=1 npx next build && npx next start -p 3200).
//   cd bpos-agent && npx electron scripts/test-caja-bpos.js
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "bpos-caja-bpos-"));
app.setPath("userData", profile);
process.env.BPOS_CAJA_URL = "http://localhost:3200";
const caja = require("../lib/caja-local");
const { createCajaStore } = require("../lib/caja-store");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  caja.registerCajaIpc();
  caja.importEntries({ bpos_theme: "dark" });
  const win = caja.openCaja("/pos");
  const errors = [];
  win.webContents.on("console-message", (e) => {
    const level = e.level ?? e;
    if (level === "error" || level === 3) errors.push(String(e.message).slice(0, 200));
  });
  await wait(15000);
  const r = await win.webContents.executeJavaScript(`({
    storage: localStorage.constructor.name,
    keys: localStorage.length,
    url: location.pathname,
    text: document.body.innerText.slice(0, 300),
  })`);
  console.log(JSON.stringify(r, null, 2));
  await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(os.tmpdir(), "caja-bpos.png"), img.toPNG()));
  BrowserWindow.getAllWindows().forEach((w) => w.destroy());
  await wait(500);
  caja.flushCaja();
  const disk = Object.keys(createCajaStore(path.join(profile, "caja-local")).load());
  console.log("En disco:", disk.length, "llaves", disk.slice(0, 15).join(", "));
  console.log("Errores de consola:", errors.length, errors.slice(0, 5));
  const pass = r.storage === "DiskStorage" && disk.length > 1;
  console.log(pass ? "\nBIEN: B-POS guarda en el disco" : "\nFALLA");
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {}
  app.exit(pass ? 0 : 1);
});
