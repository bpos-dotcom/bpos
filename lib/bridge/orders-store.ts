import fs from "node:fs";
import path from "node:path";
import { BRIDGE_DATA_DIR } from "@/lib/bridge/data-dir";

/**
 * Pedidos de delivery del Bridge, guardados en disco.
 *
 * Antes vivían solo en memoria: si se reiniciaba la computadora o B-POS con
 * un pedido sin equivalencia, el pedido se perdía y nunca se registraba la
 * venta ni se descontaba inventario. Ahora se guardan en
 * BRIDGE_DATA_DIR/bridge-orders.json y se vuelven a cargar al arrancar.
 * Los pedidos finalizados se conservan 3 días; los pendientes, siempre.
 */
const FILE = path.join(BRIDGE_DATA_DIR, "bridge-orders.json");
const KEEP_FINISHED_MS = 3 * 24 * 60 * 60 * 1000;

type StoredOrder = { status?: string; bridgeUpdatedAt?: string; bridgeReceivedAt?: string; [key: string]: unknown };

declare global {
  var bposBridgeOrders: StoredOrder[] | undefined;
  var bposBridgeOrdersSaveTimer: ReturnType<typeof setTimeout> | undefined;
}

/** La lista compartida por las rutas del Bridge (se carga del disco la primera vez). */
export function bridgeOrders<T extends StoredOrder = StoredOrder>(): T[] {
  if (!globalThis.bposBridgeOrders) {
    let loaded: StoredOrder[] = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
      if (Array.isArray(parsed)) loaded = parsed;
    } catch {
      // primera vez o archivo dañado: empieza vacío
    }
    globalThis.bposBridgeOrders = loaded;
  }
  return globalThis.bposBridgeOrders as T[];
}

/** Guarda la lista (agrupa cambios seguidos en una sola escritura). */
export function saveBridgeOrders() {
  clearTimeout(globalThis.bposBridgeOrdersSaveTimer);
  globalThis.bposBridgeOrdersSaveTimer = setTimeout(() => {
    try {
      const orders = bridgeOrders();
      const now = Date.now();
      const keep = orders.filter((o) => {
        if (o.status !== "Finalizado") return true;
        const at = Date.parse(String(o.bridgeUpdatedAt || o.bridgeReceivedAt || ""));
        return !Number.isFinite(at) || now - at < KEEP_FINISHED_MS;
      });
      if (keep.length !== orders.length) orders.splice(0, orders.length, ...keep);
      fs.mkdirSync(BRIDGE_DATA_DIR, { recursive: true });
      const tmp = `${FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(orders));
      fs.renameSync(tmp, FILE); // escritura atómica: nunca queda un archivo a medias
    } catch (error) {
      console.error("[B-POS] No se pudieron guardar los pedidos del Bridge:", error);
    }
  }, 300);
}
