"use client";
/**
 * Finanzas → Pedidos de apps: cuántos pedidos entraron por DiDi, Uber y
 * Rappi en el periodo, cuánto vendieron (precio al cliente) y su ticket
 * promedio, en barras; a un lado, la app con más pedidos y la de ticket
 * más alto. Solo informa: esas ventas no cuentan como ingreso (cuenta el
 * depósito).
 */
import { useState } from "react";

type Row = { name: string; orders: number; sales: number; ticket: number; deposited: number };
type Metric = "orders" | "sales" | "ticket";

const METRICS: [Metric, string][] = [
  ["orders", "Pedidos"],
  ["sales", "Venta"],
  ["ticket", "Ticket"],
];

export function AppsPanel({ rows, periodName, money, pct }: { rows: Row[]; periodName: string; money: (n: number) => string; pct: (n: number) => string }) {
  const [metric, setMetric] = useState<Metric>("orders");
  const total = rows.reduce((s, r) => s + r.orders, 0);
  const sales = rows.reduce((s, r) => s + r.sales, 0);
  const deposited = rows.reduce((s, r) => s + r.deposited, 0);
  const sorted = [...rows].sort((a, b) => b[metric] - a[metric]);
  const max = Math.max(1, ...rows.map((r) => r[metric]));
  const most = [...rows].sort((a, b) => b.orders - a.orders)[0];
  const best = [...rows].sort((a, b) => b.ticket - a.ticket)[0];
  const value = (r: Row) => (metric === "orders" ? `${r.orders} pedido${r.orders === 1 ? "" : "s"}` : metric === "sales" ? money(r.sales) : money(r.ticket));

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black">🛵 Pedidos de apps</h2>
          <p className="text-xs text-zinc-500">
            {total ? (
              <>
                En {periodName} entraron <b className="text-zinc-300">{total} pedidos</b> por {money(sales)} (precio al cliente). No cuentan como ingreso: abajo registras lo que te depositan.
              </>
            ) : (
              `Sin pedidos de DiDi, Uber o Rappi en ${periodName}.`
            )}
          </p>
        </div>
        {total > 0 && (
          <div className="flex overflow-hidden rounded-2xl border border-zinc-800" role="group" aria-label="Qué comparar">
            {METRICS.map(([k, text]) => (
              <button key={k} onClick={() => setMetric(k)} aria-pressed={metric === k} className={`px-3 py-1.5 text-xs font-black ${metric === k ? "bg-orange-500 text-black" : "bg-black text-zinc-400 hover:text-white"}`}>
                {text}
              </button>
            ))}
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_13rem]">
          <ul className="space-y-3">
            {sorted.map((r) => (
              <li key={r.name} title={`${r.name}: ${r.orders} pedidos · ${money(r.sales)} · ticket ${money(r.ticket)}`}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-black">{r.name}</span>
                  <span className="font-bold text-zinc-300">{value(r)}</span>
                </div>
                <div className="mt-1 h-3 overflow-hidden rounded-full bg-zinc-900">
                  <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.max(3, (r[metric] / max) * 100)}%` }} />
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {pct((r.orders / total) * 100)} de los pedidos · ticket {money(r.ticket)}
                  {r.deposited > 0 && r.sales > 0 ? ` · te depositó ${money(r.deposited)} (${pct((r.deposited / r.sales) * 100)})` : ""}
                </p>
              </li>
            ))}
          </ul>
          <div className="space-y-2 text-sm">
            {most && (
              <div className="rounded-2xl border border-zinc-800 bg-black p-3">
                <p className="text-xs text-zinc-500">📈 Más pedidos</p>
                <p className="text-lg font-black">{most.name}</p>
                <p className="text-xs text-zinc-400">
                  {most.orders} de {total} ({pct((most.orders / total) * 100)})
                </p>
              </div>
            )}
            {best && rows.length > 1 && (
              <div className="rounded-2xl border border-zinc-800 bg-black p-3">
                <p className="text-xs text-zinc-500">🎟️ Ticket más alto</p>
                <p className="text-lg font-black">{best.name}</p>
                <p className="text-xs text-zinc-400">{money(best.ticket)} por pedido</p>
              </div>
            )}
            {deposited > 0 && sales > 0 && (
              <div className="rounded-2xl border border-zinc-800 bg-black p-3">
                <p className="text-xs text-zinc-500">💵 Te llega</p>
                <p className="text-lg font-black">{pct((deposited / sales) * 100)}</p>
                <p className="text-xs text-zinc-400">de lo vendido en apps</p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
