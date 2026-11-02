"use client";
/**
 * Ventana "Mesas" del POS: todas las mesas por zona. Verde = libre; naranja =
 * con cuenta abierta (total, personas, tiempo). Una mesa libre pide cuántas
 * personas y deja el pedido como Mesa; una ocupada deja agregar otra ronda,
 * sacar la precuenta o cobrar.
 */
import { useEffect, useState } from "react";
import type { SavedOrder } from "@/components/OrderHistoryPanel";
import { openTableOrder, tableZones, type Table } from "@/lib/tables";
import { formatOrderNumber } from "@/lib/order-sequence";

type Props = {
  tables: Table[];
  orders: SavedOrder[];
  /** Mesa que trae el pedido actual (resaltada) */
  currentTableId?: string;
  onClose: () => void;
  onOpenTable: (table: Table, diners: number) => void;
  onAddRound: (order: SavedOrder, table: Table) => void;
  onPrecuenta: (order: SavedOrder) => void;
  onPay: (order: SavedOrder) => void;
};

const minutesSince = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));

export function TablesModal({ tables, orders, currentTableId, onClose, onOpenTable, onAddRound, onPrecuenta, onPay }: Props) {
  const [picked, setPicked] = useState<Table | null>(null);
  const [diners, setDiners] = useState(2);
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const active = tables.filter((t) => t.active);
  const zones = tableZones(active);
  const order = picked ? openTableOrder(orders, picked.id) : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur sm:p-6" onClick={onClose}>
      <section className="max-h-[92dvh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-zinc-800 bg-zinc-950 p-5 text-white sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-orange-500">Comer aquí</p>
            <h2 className="text-3xl font-black">🪑 Mesas</h2>
          </div>
          <button onClick={onClose} className="rounded-xl border border-zinc-800 bg-black px-4 py-2 font-black">
            ✕
          </button>
        </div>

        {active.length === 0 && (
          <p className="mt-6 rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-400">
            Todavía no hay mesas. Agrégalas en Configuración → Mesas.
          </p>
        )}

        {picked ? (
          <div className="mt-6 rounded-3xl border border-zinc-800 bg-black p-5">
            <button onClick={() => setPicked(null)} className="text-sm font-black text-zinc-400 hover:text-orange-400">
              ← Todas las mesas
            </button>
            <h3 className="mt-2 text-2xl font-black">
              Mesa {picked.name} <span className="text-base font-bold text-zinc-500">· {picked.zone}</span>
            </h3>
            {order ? (
              <>
                <p className="mt-1 text-sm text-zinc-400">
                  Pedido #{formatOrderNumber(order as SavedOrder & { localOrderNumber?: number })}
                  {order.details.diners ? ` · ${order.details.diners} personas` : ""} · abierta hace {minutesSince(order.createdAt)} min · {order.rounds || 1} {(order.rounds || 1) === 1 ? "ronda" : "rondas"}
                </p>
                <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-sm text-zinc-300">
                  {order.items.map((item, i) => (
                    <li key={`${item.lineId || item.id}-${i}`} className="flex justify-between gap-3">
                      <span>
                        {item.quantity}× {item.name}
                        {item.round && item.round > 1 ? <span className="ml-1 text-xs text-zinc-500">(ronda {item.round})</span> : null}
                      </span>
                      <span className="shrink-0">${(item.price * item.quantity).toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 flex justify-between border-t border-zinc-800 pt-3 text-xl font-black">
                  <span>Total</span>
                  <span className="text-orange-400">${order.total.toFixed(2)}</span>
                </p>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <button onClick={() => onAddRound(order, picked)} className="rounded-2xl bg-orange-500 py-3 font-black text-black">
                    ➕ Agregar ronda
                  </button>
                  <button onClick={() => onPrecuenta(order)} className="rounded-2xl border border-zinc-700 bg-zinc-900 py-3 font-black text-white">
                    🧾 Precuenta
                  </button>
                  <button onClick={() => onPay(order)} className="rounded-2xl bg-yellow-400 py-3 font-black text-black">
                    💵 Cobrar
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-1 text-sm text-zinc-400">Mesa libre. ¿Cuántas personas?</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                    <button
                      key={n}
                      onClick={() => setDiners(n)}
                      className={`h-12 w-12 rounded-2xl border text-lg font-black ${diners === n ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-800 bg-zinc-900 text-white"}`}
                    >
                      {n}
                    </button>
                  ))}
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={diners}
                    onChange={(e) => setDiners(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
                    className="h-12 w-20 rounded-2xl border border-zinc-800 bg-zinc-900 px-3 text-center text-lg font-black text-white"
                    aria-label="Personas"
                  />
                </div>
                <button onClick={() => onOpenTable(picked, diners)} className="mt-4 w-full rounded-2xl bg-orange-500 py-4 text-lg font-black text-black">
                  Abrir mesa {picked.name} · {diners} {diners === 1 ? "persona" : "personas"} → marcar productos
                </button>
              </>
            )}
          </div>
        ) : (
          zones.map((zone) => (
            <div key={zone} className="mt-6">
              <h3 className="text-sm font-black uppercase tracking-wide text-zinc-500">{zone}</h3>
              <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                {active
                  .filter((t) => t.zone === zone)
                  .map((t) => {
                    const open = openTableOrder(orders, t.id);
                    const current = t.id === currentTableId;
                    return (
                      <button
                        key={t.id}
                        onClick={() => setPicked(t)}
                        className={`flex min-h-24 flex-col items-center justify-center rounded-2xl border p-2 text-center transition ${
                          open
                            ? "border-orange-500 bg-orange-500/15 text-orange-100"
                            : "border-emerald-500/50 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
                        } ${current ? "ring-2 ring-orange-400" : ""}`}
                      >
                        <span className="text-xl font-black">{t.name}</span>
                        {open ? (
                          <>
                            <span className="text-sm font-black text-orange-300">${open.total.toFixed(2)}</span>
                            <span className="text-[11px] text-zinc-400">
                              {open.details.diners ? `${open.details.diners} pers · ` : ""}
                              {minutesSince(open.createdAt)} min
                            </span>
                          </>
                        ) : (
                          <span className="text-[11px] text-emerald-300">Libre{t.seats ? ` · ${t.seats} lugares` : ""}</span>
                        )}
                      </button>
                    );
                  })}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
