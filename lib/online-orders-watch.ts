"use client";
/**
 * Vigila los pedidos en línea nuevos de la sucursal desde cualquier
 * pantalla de B-POS: cuántos esperan (para el menú lateral; el sonido sale
 * de Configuración → Notificaciones) y, si el menú está en "Aceptar solos" y hay caja abierta, los acepta.
 * Con caja abierta también crea la venta de los que se aceptaron con la caja
 * cerrada (en la caja principal, o en la pantalla de Pedidos en línea).
 * Solo revisa si el menú digital está publicado.
 */
import { useEffect, useRef, useState } from "react";
import { DIGITAL_MENU_EVENT, awaitingOnlinePayment, getDigitalMenu, scheduledLater } from "@/lib/digital-menu";
import { ONLINE_ORDERS_EVENT, acceptOnlineOrder, createPendingOnlineSale, expireUnpaidOrder, listOnlineOrders, waitingSale, type OnlineOrder } from "@/lib/online-orders";
import { isPrimaryDevice } from "@/lib/cloud/sync";
import { startBackgroundTicker } from "@/lib/background-ticker";
import { POPUP_EVENT, announceNew, popupOrders, type OnlinePopupOrder } from "@/lib/online-orders-popup";

const CHECK_MS = 10_000;

export function useOnlineOrdersWatch() {
  const [waiting, setWaiting] = useState<{ count: number; ids: string; popup: OnlinePopupOrder[] }>({ count: 0, ids: "", popup: [] });
  const seen = useRef<Set<string> | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const menu = getDigitalMenu();
      if (!menu.enabled || !menu.slug || busy.current) {
        if (alive && !busy.current) setWaiting({ count: 0, ids: "", popup: [] });
        return;
      }
      busy.current = true;
      try {
        // Los programados esperan sin sonar hasta que toca mandarlos a cocina
        // Los que se pagan con Mercado Pago no suenan hasta que se aprueba el pago (sin pagar en 2 h, se cierran)
        const all = await listOnlineOrders();
        for (const o of all.filter((x) => x.status === "nuevo" && awaitingOnlinePayment(x.data))) await expireUnpaidOrder(o).catch(() => false);
        const fresh = all.filter((o) => o.status === "nuevo" && !awaitingOnlinePayment(o.data) && !scheduledLater(o.data, menu.scheduling.leadMinutes));
        if (!alive) return;
        const known = seen.current;
        const arrived = known ? fresh.filter((o) => !known.has(o.id)) : [];
        seen.current = new Set(fresh.map((o) => o.id));

        // Programados que ya toca: se mandan solos a cocina si hay caja abierta.
        // Los de envío por cotizar no: alguien tiene que poner cuánto se cobra.
        const open = Boolean(localStorage.getItem("bpos_active_shift"));
        const auto = (o: OnlineOrder) => !(o.data.type === "Domicilio" && o.data.deliveryQuote);
        const accepted = new Set<string>();
        if (open && !menu.autoAccept) {
          for (const order of fresh.filter((o) => o.data.scheduledFor && auto(o))) {
            try {
              await acceptOnlineOrder(order, Math.max(5, Math.round((Date.parse(order.data.scheduledFor!) - Date.now()) / 60000)), "Programado");
              accepted.add(order.id);
            } catch {
              // otro dispositivo lo tomó o falta algo: queda para aceptarlo a mano
            }
          }
        }
        if (menu.autoAccept && open) {
          for (const order of fresh.filter(auto)) {
            try {
              const eta = order.data.scheduledFor ? Math.max(5, Math.round((Date.parse(order.data.scheduledFor) - Date.now()) / 60000)) : menu.prepMinutes;
              await acceptOnlineOrder(order, eta, "Automático");
              accepted.add(order.id);
            } catch {
              // otro dispositivo lo tomó o falta algo: queda para aceptarlo a mano
            }
          }
        }
        // Aceptados con la caja cerrada: ya hay caja, se crea su venta (cocina, inventario e impresión)
        if (open && (isPrimaryDevice() || window.location.pathname === "/pedidos-en-linea")) {
          let created = false;
          for (const order of all.filter((o) => waitingSale(o) && !o.data.saleLater?.error)) {
            try {
              if (await createPendingOnlineSale(order)) created = true;
            } catch {
              // queda el motivo en el pedido (se ve en Pedidos en línea)
            }
          }
          if (created) window.dispatchEvent(new Event(ONLINE_ORDERS_EVENT));
        }
        // Lo que sigue esperando a alguien (lo que no se aceptó solo)
        const left = fresh.filter((o) => !accepted.has(o.id));
        // Ventana "llegó un pedido" (en cualquier pantalla): también los programados, una vez
        const pending = all.filter((o) => o.status === "nuevo" && !awaitingOnlinePayment(o.data) && !accepted.has(o.id));
        announceNew(pending);
        if (alive) setWaiting({ count: left.length, ids: left.map((o) => o.id).sort().join(","), popup: popupOrders(pending, menu.scheduling.leadMinutes) });
        if (arrived.length) {
          window.dispatchEvent(new Event(ONLINE_ORDERS_EVENT));
        }
      } catch {
        // sin internet o sin sesión: se intenta en la siguiente vuelta
      } finally {
        busy.current = false;
      }
    };
    void check();
    // Reloj que no se frena con la ventana minimizada
    const stopTicker = startBackgroundTicker(CHECK_MS, () => void check());
    const refresh = () => void check();
    window.addEventListener(DIGITAL_MENU_EVENT, refresh);
    window.addEventListener(ONLINE_ORDERS_EVENT, refresh);
    window.addEventListener(POPUP_EVENT, refresh);
    return () => {
      alive = false;
      stopTicker();
      window.removeEventListener(DIGITAL_MENU_EVENT, refresh);
      window.removeEventListener(ONLINE_ORDERS_EVENT, refresh);
      window.removeEventListener(POPUP_EVENT, refresh);
    };
  }, []);

  /** count: pedidos esperando; ids: cambia con cada pedido nuevo (para avisar otra vez) */
  return waiting;
}
