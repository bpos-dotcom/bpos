"use client";
/**
 * ¿Esta computadora es la caja principal? Es la que descuenta el inventario
 * de las ventas, procesa sola los pedidos de Uber, DiDi y Rappi (crea la
 * venta y manda los tickets a las estaciones) y muestra los avisos de
 * equivalencias. Va en Configuración → Sistema; en el Bridge sale un aviso si
 * esta computadora no lo es. Antes solo se cambiaba desde el letrero de
 * sincronización.
 */
import { useEffect, useState } from "react";
import { getCurrentUser } from "@/lib/auth";
import { isPrimaryDevice, setPrimaryDevice } from "@/lib/cloud/sync";
import { requirePermissionOrAdmin } from "@/lib/permissions";

export const PRIMARY_EVENT = "bpos:primary-device-updated";

export function usePrimaryDevice() {
  const [primary, setPrimary] = useState<boolean | null>(null);
  useEffect(() => {
    const sync = () => setPrimary(isPrimaryDevice());
    sync();
    window.addEventListener(PRIMARY_EVENT, sync);
    return () => window.removeEventListener(PRIMARY_EVENT, sync);
  }, []);
  const change = async (next: boolean) => {
    if (!(await requirePermissionOrAdmin(getCurrentUser(), "settings.view", next ? "marcar esta computadora como caja principal" : "quitar la caja principal"))) return;
    setPrimaryDevice(next);
    window.dispatchEvent(new Event(PRIMARY_EVENT));
  };
  return { primary, change };
}

export function PrimaryDeviceCard({ className = "" }: { className?: string }) {
  const { primary, change } = usePrimaryDevice();
  if (primary === null) return null;
  return (
    <section className={`rounded-3xl border p-6 ${primary ? "border-emerald-500/50 bg-emerald-500/10" : "border-orange-500/60 bg-orange-500/10"} ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-black">🖥️ Esta computadora {primary ? "es la caja principal" : "NO es la caja principal"}</h2>
          <p className="mt-2 text-sm text-zinc-300">La caja principal, estando en cualquier pantalla de B-POS (aunque esté minimizada):</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-400">
            <li>Procesa sola los pedidos de Uber, DiDi y Rappi: crea la venta y manda los tickets a cada estación y el de la bolsa a Caja.</li>
            <li>Muestra el aviso cuando algo no tiene equivalencia.</li>
            <li>Descuenta el inventario de las ventas.</li>
          </ul>
          <p className="mt-2 text-xs text-zinc-500">Márcala solo en la computadora de la caja (la que tiene B-POS abierto todo el día). Tablets de cocina, celulares y otras computadoras: no.</p>
        </div>
        <button
          onClick={() => void change(!primary)}
          className={`shrink-0 rounded-2xl px-5 py-3 font-black ${primary ? "border border-zinc-700 text-zinc-300" : "bg-orange-500 text-black"}`}
        >
          {primary ? "Quitar como principal" : "Hacer esta la caja principal"}
        </button>
      </div>
    </section>
  );
}

/** Aviso en el Bridge: en esta computadora los pedidos solo se procesan con esta página abierta */
export function NotPrimaryBanner() {
  const { primary, change } = usePrimaryDevice();
  if (primary !== false) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-orange-500/60 bg-orange-500/10 p-4 text-sm">
      <p className="min-w-0 flex-1 text-orange-100">
        <b>Esta computadora no es la caja principal.</b> Aquí los pedidos de Uber, DiDi y Rappi solo se procesan mientras esta página esté abierta. Si esta es la computadora de la caja, hazla principal y se procesarán solos en cualquier pantalla.
      </p>
      <button onClick={() => void change(true)} className="shrink-0 rounded-xl bg-orange-500 px-4 py-2 font-black text-black">
        Hacer esta la caja principal
      </button>
    </div>
  );
}
