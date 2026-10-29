"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { platformLabel } from "@/lib/bridge/delivery-ticket";

export type PendingEquivalence = { platform: string; orderId: string; externalName: string; rawLine: string };

const SNOOZE_KEY = "bpos_equivalence_prompt_snooze";
const SNOOZE_MS = 10 * 60 * 1000;

/**
 * Ventana que avisa cuando llega un producto de delivery sin equivalencia.
 * El ticket ya salió a cocina; lo que queda detenido es el registro (venta e
 * inventario) hasta que se equivale. "Recordarme" la esconde 10 minutos, o
 * hasta que llegue otro producto nuevo.
 */
export function EquivalencePrompt({
  items,
  signature,
  canEquivalate,
}: {
  items: PendingEquivalence[];
  signature: string;
  canEquivalate: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [snooze, setSnooze] = useState<{ signature: string; until: number } | null>(() => {
    try {
      return typeof window === "undefined" ? null : JSON.parse(sessionStorage.getItem(SNOOZE_KEY) || "null");
    } catch {
      return null;
    }
  });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const snoozed = snooze && snooze.signature === signature && snooze.until > now;
  // En el Bridge ya se está equivalando: ahí no estorba
  if (!items.length || snoozed || pathname?.startsWith("/bridge")) return null;

  function later() {
    const next = { signature, until: Date.now() + SNOOZE_MS };
    sessionStorage.setItem(SNOOZE_KEY, JSON.stringify(next));
    setSnooze(next);
  }

  function equivalate(item: PendingEquivalence) {
    const query = new URLSearchParams({ equivaler: item.externalName, plataforma: item.platform });
    router.push(`/bridge?${query.toString()}`);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-lg rounded-3xl border border-orange-500 bg-zinc-950 p-6 shadow-2xl">
        <p className="text-sm font-black text-orange-400">🛵 Pedido de delivery</p>
        <h2 className="mt-1 text-2xl font-black text-white">
          {items.length === 1 ? "Producto sin equivalencia" : `${items.length} productos sin equivalencia`}
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          El ticket ya salió a cocina. Para registrar la venta y descontar el inventario, dile a B-POS qué producto es.
          No podrás cerrar caja mientras haya productos sin equivalencia.
        </p>

        <ul className="mt-5 space-y-3">
          {items.map((item) => (
            <li key={`${item.platform}|${item.externalName}`} className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-black p-4">
              <div className="min-w-0">
                <p className="truncate font-black text-white">{item.externalName}</p>
                <p className="text-xs text-zinc-500">
                  {platformLabel(item.platform)} · Pedido #{item.orderId}
                </p>
              </div>
              {canEquivalate && (
                <button
                  onClick={() => equivalate(item)}
                  className="shrink-0 rounded-xl bg-orange-500 px-4 py-2 text-sm font-black text-black"
                >
                  Equivaler
                </button>
              )}
            </li>
          ))}
        </ul>

        {!canEquivalate && (
          <p className="mt-4 rounded-2xl border border-orange-500/40 bg-orange-500/10 p-3 text-sm font-bold text-orange-200">
            Avísale a un encargado (Admin o Gerente) para que lo equivalga en el Bridge.
          </p>
        )}

        <button onClick={later} className="mt-5 w-full rounded-2xl border border-zinc-700 py-3 text-sm font-black text-zinc-300">
          Recordarme en 10 minutos
        </button>
      </div>
    </div>
  );
}
