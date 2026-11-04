"use client";
/**
 * Modo sin internet (para todo B-POS):
 *  - instala el service worker (public/sw.js), que guarda las pantallas para
 *    que abran aunque se vaya el internet, y le pide dejar listas las
 *    principales cada vez que B-POS abre con internet;
 *  - muestra un aviso arriba mientras no hay internet: se sigue cobrando e
 *    imprimiendo en esta computadora (con su B-POS Agent) y todo se sube
 *    solo al regresar.
 */
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { isPublicPath } from "@/components/cloud/CloudGate";

const WARM_EVERY_MS = 6 * 60 * 60 * 1000;
const WARM_KEY = "bpos_offline_warm"; // solo de este dispositivo

function warm(registration: ServiceWorkerRegistration) {
  const worker = registration.active || registration.waiting || registration.installing;
  if (!worker || !navigator.onLine) return;
  try {
    const last = Number(localStorage.getItem(WARM_KEY) || 0);
    if (Date.now() - last < WARM_EVERY_MS) return;
    localStorage.setItem(WARM_KEY, String(Date.now()));
  } catch {
    // sin almacenamiento: se intenta igual
  }
  worker.postMessage({ type: "bpos:warm" });
}

export function OfflineSupport() {
  const pathname = usePathname() || "/";
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let registration: ServiceWorkerRegistration | null = null;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then(async (r) => {
        registration = r;
        await navigator.serviceWorker.ready;
        warm(r);
      })
      .catch(() => {});
    const onOnline = () => {
      try {
        localStorage.removeItem(WARM_KEY);
      } catch {}
      if (registration) warm(registration);
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline || isPublicPath(pathname)) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-[90] bg-amber-500 px-4 py-2 text-center text-sm font-black text-black shadow-lg">
      📡 Sin internet · B-POS sigue cobrando, imprimiendo y abriendo el cajón en esta computadora. Todo se sube solo cuando regrese el internet.
    </div>
  );
}
