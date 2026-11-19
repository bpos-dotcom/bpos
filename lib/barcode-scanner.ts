"use client";
/**
 * Lector de código de barras USB o Bluetooth: se comporta como un teclado
 * que escribe muy rápido el código y un Enter. Aquí se escucha en toda la
 * pantalla (cuando el cursor no está en otro campo) y se distingue de una
 * persona tecleando por la velocidad: entre tecla y tecla menos de 50 ms.
 */
import { useEffect, useRef } from "react";

const MAX_GAP_MS = 50;
const MIN_LENGTH = 4;

/** ¿Lo tecleado fue un lector? (todas las pausas cortas) */
export function looksScanned(times: number[], maxGap = MAX_GAP_MS) {
  if (times.length < MIN_LENGTH) return false;
  for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] > maxGap) return false;
  return true;
}

function isEditable(el: Element | null) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
}

export function useBarcodeScanner(onCode: (code: string) => void, enabled = true) {
  const handler = useRef(onCode);
  useEffect(() => {
    handler.current = onCode;
  }, [onCode]);

  useEffect(() => {
    if (!enabled) return;
    let chars: string[] = [];
    let times: number[] = [];
    const reset = () => {
      chars = [];
      times = [];
    };
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(document.activeElement) || e.ctrlKey || e.altKey || e.metaKey) return reset();
      // Hay una ventana encima (cobro, opciones…): el lector no agrega nada por debajo
      if (document.querySelector(".fixed.inset-0")) return reset();
      const now = performance.now();
      if (times.length && now - times[times.length - 1] > 300) reset();
      if (e.key === "Enter") {
        const code = chars.join("");
        if (code.length >= MIN_LENGTH && looksScanned(times)) {
          e.preventDefault();
          handler.current(code);
        }
        return reset();
      }
      if (e.key.length === 1 && /[0-9A-Za-z\-.]/.test(e.key)) {
        chars.push(e.key);
        times.push(now);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [enabled]);
}
