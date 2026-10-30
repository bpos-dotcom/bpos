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
const VOICE_TEXT = "Recordatorio de B-POS. Acaba de llegar un nuevo pedido del menú en línea.";
const TONE = "/sounds/BPOS_Official_Delivery_Equivalences.wav";

/** Tono y luego la voz en español, 3 veces (sin voz en español: el tono 3 veces). */
function announceNewOrder() {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  const voice = synth?.getVoices().find((v) => v.lang.toLowerCase().startsWith("es"));
  const tone = new Audio(TONE);
  if (!synth || !voice) {
    let plays = 1;
    tone.addEventListener("ended", () => {
      if (plays++ < 3) void tone.play().catch(() => {});
    });
    void tone.play().catch(() => {});
    return;
  }
  const speak = () => {
    synth.cancel();
    for (let i = 0; i < 3; i++) {
      const u = new SpeechSynthesisUtterance(VOICE_TEXT);
      u.voice = voice;
      u.lang = voice.lang;
      synth.speak(u);
    }
  };
  tone.addEventListener("ended", speak, { once: true });
  tone.play().catch(speak);
}

export function useOnlineOrdersWatch() {
  const [waiting, setWaiting] = useState(0);
  const seen = useRef<Set<string> | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let alive = true;
    // Chrome carga las voces después: se piden desde ya para tener la de español al llegar un pedido
    window.speechSynthesis?.getVoices();
    const check = async () => {
      const menu = getDigitalMenu();
      if (!menu.enabled || !menu.slug || busy.current) {
        if (alive) setWaiting(0);
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
          setWaiting(0);
        } else {
          setWaiting(fresh.length);
        }
        if (arrived.length) {
          announceNewOrder();
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

  return waiting;
}
