// Agent: pasar a la versión Cloudflare y regresar sin volver a vincular.
//   node scripts/test-version-cloudflare.js
const fs = require("fs");
const os = require("os");
const path = require("path");

// Sin despertador de verdad (websocket)
const wakePath = require.resolve("../lib/agent-wake");
require.cache[wakePath] = { id: wakePath, filename: wakePath, loaded: true, exports: { startWake: () => {}, stopWake: () => {} } };

const calls = [];
const NUBES = {
  "https://www.bpos.com.mx/api/nube": { url: "https://supa.example.co", key: "llave-supabase-123", kind: "supabase" },
  "https://bpos-nube.maderorecords.workers.dev/api/nube": { url: "https://bpos-nube.maderorecords.workers.dev/sb", key: "nube_publica_abcdef", kind: "cloudflare" },
};
global.fetch = async (url, init = {}) => {
  calls.push(String(url));
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  if (NUBES[url]) return json(NUBES[url]);
  const m = /^(.*)\/rest\/v1\/rpc\/(\w+)$/.exec(url);
  if (m) {
    const where = m[1].includes("workers.dev") ? "cloudflare" : "supabase";
    if (m[2] === "bpos_agent_pair") return json({ token: `token-${where}`, agent_id: `agente-${where}`, business_name: "Burger Planet", branch_name: where });
    if (m[2] === "bpos_agent_poll") return json({ business_name: "Burger Planet", branch_name: where, jobs: [] });
    if (m[2] === "bpos_agent_submit_order") return json({ duplicate: false, where, token: JSON.parse(init.body).p_token });
  }
  if (String(url).includes("/api/licencia")) return json({ success: false }, 400);
  return json({ message: "no" }, 404);
};

let ok = 0;
let bad = 0;
const check = (name, cond, extra) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-version-"));
  const cloud = require("../lib/cloud-link");
  cloud.startCloudLink({ dataDir, version: "2.0.26", handlers: {}, listPrinters: async () => [], applyStationPrinters: () => {} });
  await wait(50);
  check("empieza en el B-POS de siempre", !cloud.getStatus().prueba && cloud.getWebUrl() === "https://www.bpos.com.mx");
  check("habla con Supabase", cloud.getNube().url === "https://supa.example.co", cloud.getNube());
  await cloud.pair("ABCD1234");
  check("vinculado al de siempre", cloud.getStatus().linked && cloud.getLinkInfo().agentId === "agente-supabase");

  let s = await cloud.setMode(true);
  check("pasa a la versión Cloudflare", s.prueba && cloud.getWebUrl() === "https://bpos-nube.maderorecords.workers.dev" && s.webUrl === cloud.getWebUrl());
  check("habla con la nube de Cloudflare", cloud.getNube().url === "https://bpos-nube.maderorecords.workers.dev/sb", cloud.getNube());
  check("ahí todavía no está vinculado (pide código)", !s.linked);
  await cloud.pair("WXYZ9876");
  check("el código se revisa en la versión Cloudflare", calls.some((c) => c === "https://bpos-nube.maderorecords.workers.dev/sb/rest/v1/rpc/bpos_agent_pair"));
  check("vinculado a la versión Cloudflare", cloud.getLinkInfo().agentId === "agente-cloudflare");
  await wait(2600); // una vuelta del ciclo: pide el permiso de uso
  check("el permiso de uso se pide a la versión Cloudflare", calls.includes("https://bpos-nube.maderorecords.workers.dev/api/licencia"), calls.filter((c) => c.includes("licencia")));
  const sent = await cloud.submitOrder({ platform: "didi", orderId: "5", rawText: "x" });
  check("un pedido se manda a la versión Cloudflare", sent.sent && calls.filter((c) => c.endsWith("bpos_agent_submit_order")).pop().includes("workers.dev"));

  s = await cloud.setMode(false);
  check("regresa al de siempre", !s.prueba && cloud.getNube().url === "https://supa.example.co");
  check("sigue vinculado sin código nuevo", s.linked && cloud.getLinkInfo().agentId === "agente-supabase");
  await cloud.submitOrder({ platform: "didi", orderId: "6", rawText: "y" });
  check("los pedidos vuelven a la caja de siempre", calls.filter((c) => c.endsWith("bpos_agent_submit_order")).pop().startsWith("https://supa.example.co"));

  await cloud.setMode(true);
  check("al volver a Cloudflare tampoco pide código", cloud.getStatus().linked && cloud.getLinkInfo().agentId === "agente-cloudflare");
  cloud.stopCloudLink();
  const cloud2 = (delete require.cache[require.resolve("../lib/cloud-link")], require("../lib/cloud-link"));
  cloud2.startCloudLink({ dataDir, version: "2.0.26", handlers: {}, listPrinters: async () => [], applyStationPrinters: () => {} });
  check("al reiniciar recuerda en qué versión estaba", cloud2.getStatus().prueba && cloud2.getLinkInfo().agentId === "agente-cloudflare");
  await cloud2.setMode(false);
  cloud2.stopCloudLink();
  check("archivos separados", fs.existsSync(path.join(dataDir, "agent-link.json")) && fs.existsSync(path.join(dataDir, "agent-link-prueba.json")));

  console.log(`\n${ok} bien, ${bad} mal`);
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
