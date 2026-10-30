"use client";
/**
 * "¿Quién lo lleva?": al salir un pedido a domicilio (menú digital o POS) se
 * elige al repartidor y se abre WhatsApp a su número con todo el pedido.
 * Se puede cambiar si el repartidor cobra o si ya está pagado.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { DRIVERS_EVENT, assignDriverToSale, driverMessage, driverWhatsappLink, getDrivers, type DispatchInfo, type Driver } from "@/lib/drivers";

export function DispatchModal({ info, saleId, onClose }: { info: DispatchInfo; saleId?: number; onClose: () => void }) {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [paid, setPaid] = useState(info.payment.paid);
  const [sentTo, setSentTo] = useState("");

  useEffect(() => {
    const sync = () => setDrivers(getDrivers().filter((d) => d.active));
    sync();
    window.addEventListener(DRIVERS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(DRIVERS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const amount = info.payment.paid ? info.total : info.payment.amount;
  const current: DispatchInfo = {
    ...info,
    payment: paid
      ? { paid: true, method: info.payment.method }
      : { paid: false, method: info.payment.method, amount, ...(!info.payment.paid && info.payment.cashWith ? { cashWith: info.payment.cashWith } : {}) },
  };

  function send(driver: Driver) {
    const link = driverWhatsappLink(driver, current);
    if (!link) return;
    window.open(link, "_blank");
    if (saleId) assignDriverToSale(saleId, driver);
    setSentTo(driver.name);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-orange-500/40 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-orange-400">🛵 Pedido a domicilio</p>
            <h2 className="text-2xl font-black">¿Quién lo lleva?</h2>
            <p className="text-sm text-zinc-400">{info.title} · {info.customer.name}</p>
          </div>
          <button onClick={onClose} className="rounded-xl border border-zinc-700 px-3 py-1" aria-label="Cerrar">✕</button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={() => setPaid(true)} className={`rounded-2xl border py-3 text-sm font-black ${paid ? "border-emerald-400 bg-emerald-500/15 text-emerald-200" : "border-zinc-700"}`}>
            ✅ Ya está pagado
          </button>
          <button onClick={() => setPaid(false)} className={`rounded-2xl border py-3 text-sm font-black ${!paid ? "border-yellow-400 bg-yellow-500/15 text-yellow-100" : "border-zinc-700"}`}>
            💵 Cobrar ${amount.toFixed(2)}
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {drivers.map((d) => (
            <button
              key={d.id}
              onClick={() => send(d)}
              className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left ${sentTo === d.name ? "border-emerald-400 bg-emerald-500/10" : "border-zinc-700 bg-black hover:border-orange-500"}`}
            >
              <span>
                <span className="block font-black">🛵 {d.name}</span>
                <span className="text-xs text-zinc-500">{d.phone}</span>
              </span>
              <span className="rounded-xl bg-[#25d366] px-3 py-2 text-sm font-black text-black">{sentTo === d.name ? "Enviado ✓" : "WhatsApp →"}</span>
            </button>
          ))}
          {drivers.length === 0 && (
            <p className="rounded-2xl border border-dashed border-zinc-700 p-4 text-sm text-zinc-400">
              No tienes repartidores. Dalos de alta en{" "}
              <Link href="/configuracion/reparto" className="font-black text-orange-300 underline">
                Configuración → Reparto
              </Link>
              .
            </p>
          )}
        </div>

        <details className="mt-4 rounded-2xl border border-zinc-800 bg-black p-3 text-xs text-zinc-400">
          <summary className="cursor-pointer font-bold">Ver el mensaje</summary>
          <pre className="mt-2 whitespace-pre-wrap font-sans">{driverMessage(current)}</pre>
        </details>

        <button onClick={onClose} className="mt-4 w-full rounded-2xl border border-zinc-700 py-3 font-black">
          {sentTo ? "Listo" : "Ahora no"}
        </button>
      </div>
    </div>
  );
}
