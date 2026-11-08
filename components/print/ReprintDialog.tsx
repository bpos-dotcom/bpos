"use client";
/**
 * Reimprimir un pedido: elegir qué sale (comandas de ciertas estaciones, el
 * ticket del cliente en Caja y, en delivery, el ticket original). Se abre
 * desde Historial de pedidos después de confirmar; no pide PIN y le avisa al
 * dueño (bitácora "print.reprinted" con aviso al celular).
 */
import { useState } from "react";
import type { KitchenStation } from "@/data/products";
import { getCurrentUser } from "@/lib/auth";
import { addAuditEvent } from "@/lib/audit";
import { isDeliverySale, printSale, saleStations, saleTicket, STATIONS, type SaleForTickets } from "@/lib/bridge/sale-tickets";

export function ReprintDialog({ sale, onClose }: { sale: SaleForTickets; onClose: () => void }) {
  const delivery = isDeliverySale(sale);
  const used = saleStations(sale);
  const [stations, setStations] = useState<KitchenStation[]>(used);
  const [customer, setCustomer] = useState(true);
  const [original, setOriginal] = useState(false);
  const [busy, setBusy] = useState(false);
  const t = saleTicket(sale);

  function toggle(station: KitchenStation) {
    setStations((s) => (s.includes(station) ? s.filter((x) => x !== station) : [...s, station]));
  }

  async function print() {
    if (!stations.length && !customer && !original) {
      alert("Elige al menos una cosa para imprimir.");
      return;
    }
    setBusy(true);
    try {
      const failed = await printSale(sale, { stations, customer, original, drawer: false }, true);
      const user = getCurrentUser();
      const what = [stations.length ? `comandas (${stations.join(", ")})` : "", customer ? "ticket del cliente" : "", original ? "ticket original" : ""].filter(Boolean).join(", ");
      addAuditEvent({
        category: "Impresiones",
        action: "print.reprinted",
        description: `${user.name} reimprimió ${what} del pedido ${t.platform} #${t.orderId}`,
        metadata: { platform: t.platform, orderId: t.orderId, total: Number(sale.total || 0), what },
        userId: String(user.id),
        userName: user.name,
        entityId: String(sale.id),
      });
      if (failed.length) alert(`No salió en: ${failed.join(" · ")}`);
      else onClose();
    } catch {
      alert("No se pudo imprimir. Revisa que B-POS Agent esté conectado en la computadora de las impresoras.");
    } finally {
      setBusy(false);
    }
  }

  const box = "flex items-center gap-3 rounded-2xl border border-zinc-800 bg-black p-4 font-bold";
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-lg rounded-3xl border border-zinc-700 bg-zinc-950 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-black text-orange-400">¿Qué quieres reimprimir?</p>
            <h2 className="text-2xl font-black text-white">
              {t.platform} · Pedido #{t.orderId}
            </h2>
          </div>
          <button onClick={onClose} className="text-2xl text-zinc-400" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <p className="mt-5 text-sm font-black text-zinc-400">Comandas</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {STATIONS.map((station) => (
            <label key={station} className={`${box} ${used.includes(station) ? "" : "opacity-40"}`}>
              <input type="checkbox" checked={stations.includes(station)} disabled={!used.includes(station)} onChange={() => toggle(station)} />
              {station}
            </label>
          ))}
        </div>

        <p className="mt-5 text-sm font-black text-zinc-400">Tickets</p>
        <div className="mt-2 grid gap-2">
          <label className={box}>
            <input type="checkbox" checked={customer} onChange={(e) => setCustomer(e.target.checked)} />
            Ticket del cliente {delivery ? "(el de la bolsa)" : ""} · Caja
          </label>
          {delivery && (
            <label className={box}>
              <input type="checkbox" checked={original} onChange={(e) => setOriginal(e.target.checked)} />
              Ticket original de {t.platform} · Caja
            </label>
          )}
        </div>

        <button onClick={() => void print()} disabled={busy} className="mt-6 w-full rounded-2xl bg-orange-500 py-4 font-black text-black disabled:opacity-50">
          {busy ? "Imprimiendo..." : "Imprimir"}
        </button>
      </div>
    </div>
  );
}
