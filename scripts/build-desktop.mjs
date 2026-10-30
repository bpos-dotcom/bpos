// Arma el instalador de B-POS Agent para Windows (B-POS 2.0).
//
//   npm run desktop:build     BPOS-Setup-<versión>.exe en bpos-agent/dist
//   npm run desktop:release   lo anterior + lo publica en GitHub Releases
//                             (el actualizador de los Agents lo descarga solo)
//
// B-POS se usa en la web (Vercel); el instalador ya no lleva el sistema,
// solo el Agent: impresora virtual, Tesseract (OCR) e impresión.
// La versión es la de bpos-agent/package.json: súbela antes de cada release
// o los Agents no verán la actualización.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const agent = path.join(root, "bpos-agent");
const mode = process.argv[2] || "build";

function run(cmd, cwd, env = {}) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
}

let env = {};
if (mode === "release") {
  // Usa la sesión de `gh auth login` para subir a GitHub Releases
  const token = process.env.GH_TOKEN || execSync("gh auth token", { encoding: "utf8" }).trim();
  env = { GH_TOKEN: token };
}
run(`npx electron-builder --win --publish ${mode === "release" ? "always" : "never"}`, agent, env);

const version = JSON.parse(fs.readFileSync(path.join(agent, "package.json"), "utf8")).version;
console.log(`\nInstalador: bpos-agent/dist/BPOS-Setup-${version}.exe`);
