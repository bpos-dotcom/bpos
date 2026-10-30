/**
 * Bloque 12 · Notificaciones push: qué eventos de la bitácora se avisan al
 * celular del dueño y con qué texto. Lo usan la caja (para saber qué pedir)
 * y el servidor en Vercel (app/api/push/notify, que arma el aviso).
 */

/** Dirección pública de B-POS (avisos push y regreso de Mercado Pago). Las pantallas llaman a su propio servidor. */
export const PUSH_SERVER = "https://bpos-alpha.vercel.app";

/** Llave pública VAPID (la privada está solo en Vercel: VAPID_PRIVATE_KEY). */
export const VAPID_PUBLIC_KEY = "BG3WTLGsKmmVXtz7Shmfr60DQJmxRazt1pSTiHie2aAuyhnrqeyaskEIHGQ51Dr_NbfUOmT_MgzPotFxLtl9-As";

export type PushPrefs = {
  delivery: boolean; // pedidos de Rappi, Uber Eats, DiDi...
  todasVentas: boolean; // cada venta de mostrador
  ventaGrande: number; // aviso de ventas desde este monto (0 = no)
  cancelaciones: boolean;
  caja: boolean; // cortes de caja
  seguridad: boolean; // respaldos restaurados, usuarios y permisos
};

export const DEFAULT_PUSH_PREFS: PushPrefs = {
  delivery: true,
  todasVentas: false,
  ventaGrande: 500,
  cancelaciones: true,
  caja: true,
  seguridad: true,
};

/** Acciones de la bitácora que pueden generar aviso. */
export const PUSH_ACTIONS = new Set([
  "delivery.received",
  "sale.created",
  "sale.cancelled",
  "cash.closed",
  "backup.restored",
  "user.created",
  "permissions.updated",
]);

export type PushEvent = {
  event_id: string;
  action: string;
  description: string;
  metadata: Record<string, unknown> | null;
};

export type PushMessage = { title: string; body: string; tag: string; url: string };

const money = (n: number) => `$${n.toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** El aviso para este evento según lo que pidió ese celular, o null si no se avisa. */
export function pushMessage(event: PushEvent, prefsIn: Partial<PushPrefs> | null | undefined): PushMessage | null {
  const prefs = { ...DEFAULT_PUSH_PREFS, ...(prefsIn || {}) };
  const meta = event.metadata || {};
  const total = Number(meta.total) || 0;
  const tag = event.event_id;

  switch (event.action) {
    case "delivery.received":
      if (!prefs.delivery) return null;
      return { title: `🛵 Pedido ${meta.platform || "delivery"} · ${money(total)}`, body: event.description, tag, url: "/dueno" };
    case "sale.created": {
      const big = prefs.ventaGrande > 0 && total >= prefs.ventaGrande;
      if (!prefs.todasVentas && !big) return null;
      return { title: big ? `💰 Venta grande · ${money(total)}` : `Venta nueva · ${money(total)}`, body: event.description, tag, url: "/dueno" };
    }
    case "sale.cancelled":
      if (!prefs.cancelaciones) return null;
      return { title: `❌ Venta cancelada${total ? ` · ${money(total)}` : ""}`, body: event.description, tag, url: "/configuracion/auditoria" };
    case "cash.closed": {
      if (!prefs.caja) return null;
      const diff = Number(meta.difference) || 0;
      return {
        title: diff === 0 ? "🔒 Corte de caja" : `⚠️ Corte con ${diff < 0 ? "faltante" : "sobrante"} de ${money(Math.abs(diff))}`,
        body: event.description,
        tag,
        url: "/dueno",
      };
    }
    case "backup.restored":
    case "user.created":
    case "permissions.updated":
      if (!prefs.seguridad) return null;
      return { title: "🔐 Seguridad", body: event.description, tag, url: "/configuracion/auditoria" };
    default:
      return null;
  }
}
