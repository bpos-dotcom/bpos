// B-POS 2.0 · Conexión de B-POS Agent con la nube.
// B-POS se usa en la web; este Agent se vincula a una sucursal con un código
// de 8 letras (Configuración → Sistema) y desde entonces, cada 2 segundos:
//   - avisa que sigue conectado (y qué impresoras tiene la PC),
//   - recoge lo que las pantallas mandaron a imprimir y deja el resultado,
//   - recibe qué impresora tiene cada estación.
// Los pedidos leídos de Rappi/Uber/DiDi se suben a la nube; si no hay
// internet o no está vinculado, esperan en una bandeja de salida en disco.
// Todo pasa por funciones bpos_agent_* de Supabase con la llave del Agent.
const fs = require("fs");
const path = require("path");
const os = require("os");

// Proyecto de Supabase de B-POS. La llave "publishable" es pública por diseño
// (la seguridad la dan las funciones, que revisan la llave del Agent).
const SUPABASE_URL = "https://fhsqwbtkxpzvmqplwqul.supabase.co";
const SUPABASE_KEY = "sb_publishable_noKOXLF2fFBR2TCbgkxGRg__GlHxzbS";
/** B-POS en la web (botón "Abrir B-POS") */
const WEB_URL = "https://bpos-alpha.vercel.app";

const POLL_MS = 2000;
const POLL_OFFLINE_MS = 6000;
const PRINTERS_EVERY_MS = 60_000;
const OUTBOX_EVERY_MS = 15_000;

let dataDir = "";
let link = null; // { token, agentId, businessName, branchName, pairedAt, imported }
let handlers = {};
let listPrinters = async () => [];
let applyStationPrinters = () => {};
let version = "";
let status = { state: "unlinked", message: "Sin vincular", lastPollAt: null };
const listeners = new Set();
let pollTimer = null;
let lastPrintersAt = 0;
let lastStationConfig = "";
let outboxTimer = null;

function linkFile() {
  return path.join(dataDir, "agent-link.json");
}
function outboxFile() {
  return path.join(dataDir, "outbox.json");
}

function setStatus(patch) {
  // La hora del último aviso cambia cada 2 s: no cuenta como cambio para la ventana
  const visible = (s) => JSON.stringify({ ...s, lastPollAt: undefined });
  const before = visible(status);
  status = { ...status, ...patch };
  if (visible(status) !== before || patch.pending !== undefined) listeners.forEach((l) => l(getStatus()));
}

function getStatus() {
  return {
    ...status,
    linked: Boolean(link),
    businessName: link?.businessName || "",
    branchName: link?.branchName || "",
    pending: readOutbox().length,
  };
}

function onStatus(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function rpc(name, params) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const error = new Error(body?.message || `La nube respondió ${response.status}`);
    error.code = body?.code;
    throw error;
  }
  return body;
}

function readLink() {
  try {
    const saved = JSON.parse(fs.readFileSync(linkFile(), "utf8"));
    return saved?.token ? saved : null;
  } catch {
    return null;
  }
}

function writeLink(next) {
  link = next;
  fs.mkdirSync(dataDir, { recursive: true });
  if (next) fs.writeFileSync(linkFile(), JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
  else fs.rmSync(linkFile(), { force: true });
}

// ------------------------------------------------------------ bandeja de salida

function readOutbox() {
  try {
    const list = JSON.parse(fs.readFileSync(outboxFile(), "utf8"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeOutbox(list) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(outboxFile(), JSON.stringify(list.slice(-500)));
}

/** Sube un pedido. Si no se puede ahora, queda en la bandeja y se reintenta solo. */
async function submitOrder(order) {
  if (link) {
    try {
      const result = await rpc("bpos_agent_submit_order", { p_token: link.token, p_order: order });
      return { sent: true, duplicate: Boolean(result?.duplicate) };
    } catch (error) {
      handleAuthError(error);
      console.error("No se pudo subir el pedido a la nube (queda en espera):", error.message);
    }
  }
  writeOutbox([...readOutbox(), order]);
  setStatus({});
  return { sent: false, duplicate: false };
}

async function flushOutbox() {
  if (!link) return;
  const list = readOutbox();
  if (!list.length) return;
  const left = [];
  for (const order of list) {
    try {
      await rpc("bpos_agent_submit_order", { p_token: link.token, p_order: order });
      console.log(`Pedido en espera subido a la nube: ${order.platform}:${order.orderId}`);
    } catch (error) {
      handleAuthError(error);
      left.push(order);
    }
  }
  writeOutbox(left);
  setStatus({});
}

// ------------------------------------------------------------ vincular

/** El negocio desvinculó este Agent desde la web: se olvida la llave. */
function handleAuthError(error) {
  if (error?.code === "28000" && link) {
    console.warn("Este Agent fue desvinculado desde B-POS.");
    writeLink(null);
    setStatus({ state: "unlinked", message: "Desvinculado desde B-POS. Escribe un código nuevo para vincularlo." });
  }
}

async function pair(code) {
  const result = await rpc("bpos_agent_pair", { p_code: String(code || ""), p_name: os.hostname(), p_version: version });
  writeLink({
    token: result.token,
    agentId: result.agent_id,
    businessName: result.business_name,
    branchName: result.branch_name,
    pairedAt: new Date().toISOString(),
    imported: false,
  });
  console.log(`Agent vinculado a ${result.business_name} · ${result.branch_name}`);
  lastPrintersAt = 0;
  lastStationConfig = "";
  await importLegacyData().catch((error) => console.error("No se pudieron subir los datos de B-POS 1.x:", error.message));
  void flushOutbox();
  schedulePoll(0);
  return getStatus();
}

function unlink() {
  writeLink(null);
  setStatus({ state: "unlinked", message: "Sin vincular" });
}

/** B-POS 1.x guardaba equivalencias y pedidos pendientes en esta PC: se suben una vez. */
async function importLegacyData() {
  if (!link || link.imported) return;
  const read = (name) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dataDir, name), "utf8"));
    } catch {
      return null;
    }
  };
  const aliasesFile = read("bridge-aliases.json");
  const aliases = Array.isArray(aliasesFile?.aliases) ? aliasesFile.aliases : [];
  const ordersFile = read("bridge-orders.json");
  const orders = (Array.isArray(ordersFile) ? ordersFile : []).filter((o) => o && o.status !== "Finalizado");
  if (aliases.length || orders.length) {
    const result = await rpc("bpos_agent_import", { p_token: link.token, p_aliases: aliases, p_orders: orders });
    console.log(`Datos de B-POS 1.x subidos a la nube: ${result?.aliases ?? 0} equivalencias, ${result?.orders ?? 0} pedidos.`);
  }
  writeLink({ ...link, imported: true });
}

// ------------------------------------------------------------ ciclo

/** Configuración → Impresoras (guardada en la web) al formato del Agent */
function toStationConfig(saved) {
  const pick = (s) => (saved && typeof saved[s] === "string" ? saved[s] : "");
  return {
    printers: { Parrilla: pick("Parrilla"), Freidora: pick("Freidora"), Barra: pick("Barra"), Cocina: pick("Cocina"), Caja: pick("Caja") },
    paperWidthMm: Number(saved?.paperWidthMm) === 58 ? 58 : 80,
    printMode: saved?.printMode === "windows" ? "windows" : "escpos",
  };
}

async function runJob(job) {
  const handler = handlers[job.kind];
  let ok = false;
  let result;
  try {
    if (!handler) throw new Error(`Este Agent no sabe hacer "${job.kind}". Actualízalo.`);
    result = await handler(job.payload || {});
    ok = result?.success !== false;
  } catch (error) {
    result = { success: false, error: error.message };
  }
  try {
    await rpc("bpos_agent_finish", { p_token: link.token, p_job_id: job.id, p_ok: ok, p_result: result ?? {} });
  } catch (error) {
    console.error(`No se pudo avisar el resultado del trabajo ${job.id}:`, error.message);
  }
}

async function pollOnce() {
  if (!link) {
    setStatus({ state: "unlinked", message: status.state === "unlinked" ? status.message : "Sin vincular" });
    return POLL_OFFLINE_MS;
  }
  let printers = null;
  if (Date.now() - lastPrintersAt > PRINTERS_EVERY_MS) {
    try {
      printers = await listPrinters();
      lastPrintersAt = Date.now();
    } catch (error) {
      console.error("No se pudieron leer las impresoras:", error.message);
    }
  }
  try {
    const result = await rpc("bpos_agent_poll", { p_token: link.token, p_version: version, p_printers: printers });
    if (result.business_name !== link.businessName || result.branch_name !== link.branchName) {
      writeLink({ ...link, businessName: result.business_name, branchName: result.branch_name });
    }
    const config = JSON.stringify(result.station_printers ?? null);
    if (result.station_printers && config !== lastStationConfig) {
      try {
        applyStationPrinters(toStationConfig(result.station_printers));
        lastStationConfig = config;
      } catch (error) {
        console.error("No se pudo guardar la configuración de impresoras:", error.message);
      }
    }
    setStatus({ state: "connected", message: "Conectado a B-POS", lastPollAt: new Date().toISOString() });
    for (const job of result.jobs || []) await runJob(job);
    return POLL_MS;
  } catch (error) {
    handleAuthError(error);
    if (link) setStatus({ state: "offline", message: `Sin conexión con la nube: ${String(error.message).slice(0, 120)}` });
    return POLL_OFFLINE_MS;
  }
}

function schedulePoll(ms) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    let next = POLL_OFFLINE_MS;
    try {
      next = await pollOnce();
    } finally {
      schedulePoll(next);
    }
  }, ms);
}

/**
 * @param {{ dataDir: string, version: string, handlers: Record<string, (payload: any) => Promise<any>>,
 *   listPrinters: () => Promise<any[]>, applyStationPrinters: (config: any) => void }} opts
 */
function startCloudLink(opts) {
  dataDir = opts.dataDir;
  version = opts.version;
  handlers = opts.handlers;
  listPrinters = opts.listPrinters;
  applyStationPrinters = opts.applyStationPrinters;
  link = readLink();
  if (link) {
    setStatus({ state: "connecting", message: "Conectando..." });
    void importLegacyData().catch((error) => console.error("No se pudieron subir los datos de B-POS 1.x:", error.message));
  }
  schedulePoll(500);
  outboxTimer = setInterval(() => void flushOutbox(), OUTBOX_EVERY_MS);
}

function stopCloudLink() {
  clearTimeout(pollTimer);
  clearInterval(outboxTimer);
}

module.exports = { startCloudLink, stopCloudLink, submitOrder, pair, unlink, onStatus, getStatus, WEB_URL };
