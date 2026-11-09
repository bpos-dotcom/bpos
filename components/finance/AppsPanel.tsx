"use client";
/**
 * Finanzas → Pedidos de apps: cuántos pedidos entraron por DiDi, Uber y
 * Rappi en el periodo, cuánto vendieron (precio al cliente) y su ticket
 * promedio, en barras; a un lado, la app con más pedidos y la de ticket
 * más alto. Solo informa: esas ventas no cuentan como ingreso (cuenta el
 * depósito).
 */
import { useState } from "react";
import { isConfigured, netFactor, type AppCommission } from "@/lib/app-commissions";

/** pending: depósito estimado de las semanas que aún no tienen el real */
type Row = { name: string; orders: number; sales: number; ticket: number; deposited: number; pending?: number };
type Metric = "orders" | "sales" | "ticket";

/** Hasta cuántos puntos de diferencia contra lo esperado se considera correcto */
const TOLERANCE = 3;

const METRICS: [Metric, string][] = [
  ["orders", "Pedidos"],
  ["sales", "Venta"],
  ["ticket", "Ticket"],
];

export function AppsPanel({ rows, periodName, money, pct, commissions }: { rows: Row[]; periodName: string; money: (n: number) => string; pct: (n: number) => string; commissions: Record<string, AppCommission> }) {
  const [metric, setMetric] = useState<Metric>("orders");
  const total = rows.reduce((s, r) => s + r.orders, 0);
  const sales = rows.reduce((s, r) => s + r.sales, 0);
  const paid = rows.filter((r) => r.deposited > 0 && r.sales > 0);
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
          <div className="space-y-4">
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
            {paid.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {paid.map((r) => (
                  <DepositCheck key={r.name} row={r} commission={commissions[r.name]} money={money} pct={pct} />
                ))}
              </div>
            )}
          </div>
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
          </div>
        </div>
      )}
    </section>
  );
}

/** Lo que te depositó una app contra lo esperado por su comisión e impuestos, con un foquito verde o rojo */
function DepositCheck({ row, commission, money, pct }: { row: Row; commission?: AppCommission; money: (n: number) => string; pct: (n: number) => string }) {
  const configured = isConfigured(commission);
  const expected = configured ? netFactor(commission) * 100 : 0;
  // Solo lo vendido en semanas que ya tienen depósito real
  const coveredSales = configured && row.pending && expected > 0 ? Math.max(1, row.sales - row.pending / (expected / 100)) : row.sales;
  const got = (row.deposited / coveredSales) * 100;
  const ok = configured && Math.abs(got - expected) <= TOLERANCE;
  const diff = configured ? row.deposited - (coveredSales * expected) / 100 : 0;
  const light = !configured ? "bg-zinc-600" : ok ? "bg-emerald-400 shadow-[0_0_12px_#34d399]" : "bg-red-500 shadow-[0_0_12px_#ef4444]";
  const basis = configured ? `${commission.commission || 0}% de comisión, ${commission.taxes || 0}% de impuestos` : "";
  return (
    <div className={`rounded-2xl border bg-black p-3 ${!configured ? "border-zinc-800" : ok ? "border-emerald-500/40" : "border-red-500/50"}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-lg font-black">{row.name}</p>
          <p className="text-xs text-zinc-400">
            Recibes <b className="text-base text-white">{pct(got)}</b> de lo que vendiste en {row.name}
          </p>
        </div>
        <span className={`mt-1 h-4 w-4 shrink-0 rounded-full ${light}`} aria-hidden />
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        {money(row.deposited)} de {money(coveredSales)} vendidos
      </p>
      {configured ? (
        <p className={`mt-1 text-xs font-bold ${ok ? "text-emerald-300" : "text-red-300"}`}>
          {ok ? "Correcto" : "Incorrecto"} al aproximado según: {basis} ({pct(expected)} esperado)
          {!ok && <span className="block font-normal text-zinc-400">{diff < 0 ? `Te faltan aprox. ${money(-diff)}` : `Te llegaron aprox. ${money(diff)} de más`}</span>}
        </p>
      ) : (
        <p className="mt-1 text-xs text-zinc-500">Configura sus comisiones (⚙️ Comisiones de apps) para saber si está bien.</p>
      )}
    </div>
  );
}
