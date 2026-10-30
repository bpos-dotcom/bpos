"use client";
/**
 * Vigila los pedidos en línea nuevos de la sucursal desde cualquier
 * pantalla de B-POS: cuántos esperan (para el menú lateral), suena al llegar
 * uno y, si el menú está en "Aceptar solos" y hay caja abierta, los acepta.
 * Solo revisa si el menú digital está publicado.
 */
import { useEffect, useRef, useState } from "react";
import { DIGITAL_MENU_EVENT, getDigitalMenu } from "@/lib/digital-menu";
import { ONLINE_ORDERS_EVENT, acceptOnlineOrder, listOnlineOrders } from "@/lib/online-orders";

const CHECK_MS = 10_000;
export function useOnlineOrdersWatch() {
  const [waiting, setWaiting] = useState<{ count: number; ids: string }>({ count: 0, ids: "" });
  const seen = useRef<Set<string> | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let alive = true;
    // Chrome carga las voces después: se piden desde ya para tener la de español al llegar un pedido
    window.speechSynthesis?.getVoices();
    const check = async () => {
      const menu = getDigitalMenu();
      if (!menu.enabled || !menu.slug || busy.current) {
        if (alive) setWaiting({ count: 0, ids: "" });
        return;
      }
      busy.current = true;
      try {
        const fresh = (await listOnlineOrders()).filter((o) => o.status === "nuevo");
        if (!alive) return;
        const known = seen.current;
        const arrived = known ? fresh.filter((o) => !known.has(o.id)) : [];
        seen.current = new Set(fresh.map((o) => o.id));

        if (menu.autoAccept && localStorage.getItem("bpos_active_shift")) {
          for (const order of fresh) {
            try {
              await acceptOnlineOrder(order, menu.prepMinutes, "Automático");
            } catch {
              // otro dispositivo lo tomó o falta algo: queda para aceptarlo a mano
            }
          }
          setWaiting({ count: 0, ids: "" });
        } else {
          setWaiting({ count: fresh.length, ids: fresh.map((o) => o.id).sort().join(",") });
        }
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
    const timer = setInterval(() => void check(), CHECK_MS);
    const refresh = () => void check();
    window.addEventListener(DIGITAL_MENU_EVENT, refresh);
    window.addEventListener(ONLINE_ORDERS_EVENT, refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener(DIGITAL_MENU_EVENT, refresh);
      window.removeEventListener(ONLINE_ORDERS_EVENT, refresh);
    };
  }, []);

  /** count: pedidos esperando; ids: cambia con cada pedido nuevo (para avisar otra vez) */
  return waiting;
}
