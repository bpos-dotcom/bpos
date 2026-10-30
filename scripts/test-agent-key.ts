/**
 * Llave del Agent en una instalación nueva (antes: "Inicia sesión en B-POS
 * para usar el Bridge" en cada pedido). npx tsx scripts/test-agent-key.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "bpos-key-"));
process.env.USERPROFILE = home;
process.env.HOME = home;
process.env.BPOS_REQUIRE_AGENT_KEY = "1";
const keyFile = path.join(home, ".bpos", "agent-key");

let ok = 0, bad = 0;
function check(name: string, cond: boolean) {
  if (cond) ok++; else { bad++; console.log("✗", name); }
}

async function main() {
  const { NextRequest } = await import("next/server");
  const { guardBridgeRequest } = await import("../lib/bridge/api-guard");
  const req = (headers: Record<string, string> = {}) =>
    new NextRequest("http://localhost:3000/api/bridge/orders", { method: "POST", headers: { host: "localhost:3000", ...headers } });

  check("instalación nueva: sin llave todavía", !fs.existsSync(keyFile));
  const first = await guardBridgeRequest(req(), { agent: true });
  check("pedido sin llave se rechaza", first?.status === 401);
  check("pero la llave queda creada para el Agent", fs.existsSync(keyFile));

  const key = fs.readFileSync(keyFile, "utf8").trim();
  check("con la llave del archivo se acepta", (await guardBridgeRequest(req({ "x-bpos-agent-key": key }), { agent: true })) === null);
  check("llave equivocada se rechaza", (await guardBridgeRequest(req({ "x-bpos-agent-key": "x".repeat(64) }), { agent: true }))?.status === 401);

  // El Agent la crea/cambia después de que el servidor la guardó en memoria
  const agentKey = "a".repeat(64);
  fs.writeFileSync(keyFile, agentKey);
  check("llave creada por el Agent después: se acepta", (await guardBridgeRequest(req({ "x-bpos-agent-key": agentKey }), { agent: true })) === null);
  check("rutas que no son del Agent no aceptan la llave", (await guardBridgeRequest(req({ "x-bpos-agent-key": agentKey }))) !== null);

  fs.rmSync(home, { recursive: true, force: true });
  console.log(`${ok} bien, ${bad} mal`);
  if (bad) process.exit(1);
}
void main();
