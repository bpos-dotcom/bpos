"use client";

export type KdsStatus = "Nuevo" | "En preparación" | "Listo" | "Entregado";

export const KDS_ORDERS_KEY = "bpos_orders";
export const KDS_CRITICAL_ERRORS_KEY = "bpos_critical_errors";

export type KdsCriticalError = {
  id: string;
  type: "kds-delivery-error";
  title: string;
  message: string;
  orderId?: number;
  createdAt: string;
  acknowledged: boolean;
};

export function createKdsCriticalError(input: {
  orderId?: number;
  message: string;
}) {
  if (typeof window === "undefined") return;

  try {
    const current = JSON.parse(
      localStorage.getItem(KDS_CRITICAL_ERRORS_KEY) || "[]"
    );
    const errors = Array.isArray(current) ? current : [];
    const error: KdsCriticalError = {
      id: `kds-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "kds-delivery-error",
      title: "Pedido no enviado al KDS",
      message: input.message,
      orderId: input.orderId,
      createdAt: new Date().toISOString(),
      acknowledged: false,
    };

    localStorage.setItem(
      KDS_CRITICAL_ERRORS_KEY,
      JSON.stringify([error, ...errors])
    );
    window.dispatchEvent(new Event("bpos:critical-errors-updated"));
  } catch (error) {
    console.error("No se pudo registrar la incidencia del KDS:", error);
  }
}

export function notifyKdsUpdated(orderId?: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("bpos:kds-updated", { detail: { orderId } })
  );
}
