"use client";
/**
 * Reloj que no se frena con la ventana minimizada. Chrome (y la app de B-POS
 * en Windows) espacia los setInterval de una pestaña oculta hasta una vez por
 * minuto; los de un Worker no. Así el procesador del Bridge sigue revisando
 * cada 2 s aunque la caja esté minimizada (el Agent solo espera 45 s antes de
 * sacar el ticket original en Cocina). Sin Worker, cae a setInterval.
 */
export function startBackgroundTicker(ms: number, onTick: () => void): () => void {
  try {
    const source = `setInterval(function () { postMessage(0); }, ${Math.max(250, Math.round(ms))});`;
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const worker = new Worker(url);
    worker.onmessage = () => onTick();
    return () => {
      worker.terminate();
      URL.revokeObjectURL(url);
    };
  } catch {
    const id = window.setInterval(onTick, ms);
    return () => window.clearInterval(id);
  }
}
