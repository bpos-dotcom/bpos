// Bloque 13 · electron-builder deja fuera cualquier node_modules de
// extraResources, pero el servidor de B-POS (bpos-agent/web, build
// standalone de Next) los necesita. Este paso copia la carpeta completa a
// resources/web después de empaquetar y antes de armar el instalador.
const fs = require("fs");
const path = require("path");

exports.default = async function afterPack(context) {
  const from = path.join(context.packager.projectDir, "web");
  const to = path.join(context.appOutDir, "resources", "web");
  if (!fs.existsSync(path.join(from, "server.js"))) {
    throw new Error("Falta bpos-agent/web: corre `npm run desktop:prepare` en la raíz del proyecto.");
  }
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
  if (!fs.existsSync(path.join(to, "node_modules", "next"))) throw new Error("No se copiaron los node_modules del servidor.");
  console.log(`  • B-POS web copiado a ${path.relative(context.packager.projectDir, to)}`);
};
