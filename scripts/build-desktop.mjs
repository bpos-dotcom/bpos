// Bloque 13 · Arma el instalador de B-POS para Windows.
//
//   npm run desktop:prepare   build de producción de B-POS → bpos-agent/web
//   npm run desktop:build     lo anterior + BPOS-Setup-<versión>.exe en bpos-agent/dist
//   npm run desktop:release   lo anterior + lo publica en GitHub Releases
//                             (el actualizador de las cajas lo descarga solo)
//
// La versión del instalador es la de bpos-agent/package.json: súbela antes
// de cada release o las cajas no verán la actualización.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const agent = path.join(root, "bpos-agent");
const web = path.join(agent, "web");
const mode = process.argv[2] || "build";

function run(cmd, cwd, env = {}) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
}

// 1. Build de producción (output: "standalone" en next.config.ts)
run("npx next build", root);

// 2. Copiar servidor + archivos estáticos a bpos-agent/web
const standalone = path.join(root, ".next", "standalone");
if (!fs.existsSync(path.join(standalone, "server.js"))) throw new Error("No se generó .next/standalone/server.js");
fs.rmSync(web, { recursive: true, force: true });
fs.cpSync(standalone, web, { recursive: true });
fs.cpSync(path.join(root, ".next", "static"), path.join(web, ".next", "static"), { recursive: true });
fs.cpSync(path.join(root, "public"), path.join(web, "public"), { recursive: true });
// Datos iniciales del Bridge (la app los copia a %APPDATA%/B-POS/data la primera vez)
fs.cpSync(path.join(root, "data"), path.join(web, "data"), {
  recursive: true,
  filter: (src) => fs.statSync(src).isDirectory() || src.endsWith(".json"),
});
console.log(`\nB-POS listo en ${path.relative(root, web)}`);
if (mode === "prepare") process.exit(0);

// 3. Instalador (y publicación)
let env = {};
if (mode === "release") {
  // Usa la sesión de `gh auth login` para subir a GitHub Releases
  const token = process.env.GH_TOKEN || execSync("gh auth token", { encoding: "utf8" }).trim();
  env = { GH_TOKEN: token };
}
run(`npx electron-builder --win --publish ${mode === "release" ? "always" : "never"}`, agent, env);

const version = JSON.parse(fs.readFileSync(path.join(agent, "package.json"), "utf8")).version;
console.log(`\nInstalador: bpos-agent/dist/BPOS-Setup-${version}.exe`);
