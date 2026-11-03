/**
 * Despertador del Agent: B-POS (la web) manda un aviso por Supabase Realtime
 * (broadcast en el canal agent-<id>) cada vez que deja un trabajo (imprimir,
 * abrir el cajón). Al recibirlo, el Agent revisa la cola de inmediato en vez
 * de esperar su siguiente vuelta. Es solo un acelerador: si el socket se cae,
 * la revisión periódica sigue igual.
 */
const HEARTBEAT_MS = 25_000;
const RECONNECT_MIN_MS = 3_000;
const RECONNECT_MAX_MS = 60_000;

let socket = null;
let heartbeat = null;
let reconnectTimer = null;
let reconnectMs = RECONNECT_MIN_MS;
let current = null; // { url, key, topic, onWake }
let ref = 0;

function send(message) {
  if (socket && socket.readyState === 1) socket.send(JSON.stringify({ ...message, ref: String(++ref) }));
}

function connect() {
  if (!current || typeof WebSocket === "undefined") return;
  const { url, key, topic, onWake } = current;
  const wsUrl = `${url.replace(/^http/, "ws")}/realtime/v1/websocket?apikey=${encodeURIComponent(key)}&vsn=1.0.0`;
  try {
    socket = new WebSocket(wsUrl);
  } catch (error) {
    console.error("Despertador: no se pudo abrir el socket:", error.message);
    scheduleReconnect();
    return;
  }
  socket.onopen = () => {
    reconnectMs = RECONNECT_MIN_MS;
    send({ topic: `realtime:${topic}`, event: "phx_join", payload: { config: { broadcast: { self: false, ack: false }, presence: { key: "" }, private: false }, access_token: key } });
    clearInterval(heartbeat);
    heartbeat = setInterval(() => send({ topic: "phoenix", event: "heartbeat", payload: {} }), HEARTBEAT_MS);
  };
  socket.onmessage = (event) => {
    let message = null;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message?.event === "broadcast") onWake();
  };
  socket.onerror = () => {};
  socket.onclose = () => {
    clearInterval(heartbeat);
    heartbeat = null;
    socket = null;
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (!current) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, reconnectMs);
  reconnectMs = Math.min(reconnectMs * 2, RECONNECT_MAX_MS);
}

/** @param {{ url: string, key: string, topic: string, onWake: () => void }} opts */
function startWake(opts) {
  stopWake();
  current = opts;
  connect();
}

function stopWake() {
  current = null;
  clearTimeout(reconnectTimer);
  clearInterval(heartbeat);
  heartbeat = null;
  if (socket) {
    try {
      socket.close();
    } catch {
      // ya cerrado
    }
    socket = null;
  }
}

module.exports = { startWake, stopWake };
