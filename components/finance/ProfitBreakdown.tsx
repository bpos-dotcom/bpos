"use client";
/**
 * Finanzas → de dónde sale la utilidad, renglón por renglón: ingresos locales
 * (efectivo, tarjeta, transferencia...), ingresos por apps (lo estimado por
 * sus comisiones contra el depósito real), costo de lo vendido, gastos y los
 * faltantes o sobrantes de caja, con los cortes en un desplegable.
 */
import type { ReactNode } from "react";

type Part = { label: string; amount: number };
export type AppIncome = { name: string; deposited: number; expected: number | null; pending: number };
type Cut = { folio: string; closedAt: string; difference: number; reason: string };

function Line({ sign, label, amount, money, strong, children }: { sign?: string; label: ReactNode; amount: number; money: (n: number) => string; strong?: boolean; children?: ReactNode }) {
  return (
    <li className="py-1.5">
      <div className={`flex items-baseline justify-between gap-3 ${strong ? "font-black text-white" : "text-zinc-300"}`}>
        <span>
          {sign && <span className="mr-1 inline-block w-3 text-zinc-500">{sign}</span>}
          {label}
        </span>
        <span className="font-black tabular-nums">{money(amount)}</span>
      </div>
      {children && <div className="ml-4 mt-0.5 space-y-0.5 text-xs text-zinc-500">{children}</div>}
    </li>
  );
}

export function ProfitBreakdown({
  local,
  apps,
  appsTotal,
  cost,
  expenses,
  cashDiff,
  cuts,
  net,
  netMargin,
  periodName,
  money,
  pct,
}: {
  local: Part[];
  apps: AppIncome[];
  appsTotal: number;
  cost: number;
  expenses: number;
  cashDiff: number;
  cuts: Cut[];
  net: number;
  netMargin: number;
  periodName: string;
  money: (n: number) => string;
  pct: (n: number) => string;
}) {
  const localTotal = local.reduce((s, p) => s + p.amount, 0);
  return (
    <ul className="mt-3 max-w-2xl divide-y divide-zinc-800/70 rounded-2xl border border-zinc-800 bg-black/40 px-4 py-1 text-sm">
      <Line label="Ingresos" amount={localTotal + appsTotal} money={money} strong>
        <div className="flex items-baseline justify-between gap-3 text-zinc-300">
          <span>🏪 Ingresos locales:</span>
          <span className="tabular-nums">{money(localTotal)}</span>
        </div>
        {local.length > 0 && <p className="ml-5">{local.map((p) => `${p.label} ${money(p.amount)}`).join(" · ")}</p>}
        {(appsTotal > 0.5 || apps.length > 0) && (
          <>
            <div className="flex items-baseline justify-between gap-3 pt-1 text-zinc-300">
              <span>🛵 Ingresos por apps:</span>
              <span className="tabular-nums">{money(appsTotal)}</span>
            </div>
            {apps.map((a) => (
              <p key={a.name} className="ml-5">
                <b className="text-zinc-400">{a.name}:</b>{" "}
                {[
                  a.expected !== null ? `estimado ${money(a.expected)}` : "",
                  a.deposited > 0 ? `depósito real ${money(a.deposited)}` : "",
                  a.pending > 0 ? `${money(a.pending)} estimado (falta registrar su depósito)` : "",
                  a.expected === null && a.deposited <= 0 && a.pending <= 0 ? "sin depósito ni comisiones configuradas" : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
                {a.expected !== null && a.deposited > 0 && (
                  <span className={a.deposited - a.expected < -0.5 ? " text-red-300" : " text-emerald-300"}>
                    {" "}
                    ({a.deposited - a.expected >= 0 ? "+" : "−"}
                    {money(Math.abs(a.deposited - a.expected))})
                  </span>
                )}
              </p>
            ))}
          </>
        )}
      </Line>
      <Line sign="−" label="Costo de lo vendido" amount={cost} money={money} />
      <Line sign="−" label="Gastos" amount={expenses} money={money} />
      {cuts.length > 0 && (
        <li className="py-1.5">
          <details>
            <summary className={`flex cursor-pointer list-none items-baseline justify-between gap-3 ${cashDiff < 0 ? "text-red-300" : "text-emerald-300"}`}>
              <span>
                <span className="mr-1 inline-block w-3 text-zinc-500">{cashDiff < 0 ? "−" : "+"}</span>
                {cashDiff < 0 ? "Faltantes de caja" : cashDiff > 0 ? "Sobrantes de caja" : "Diferencias de caja (se compensan)"}{" "}
                <span className="text-xs text-zinc-500 underline underline-offset-2">ver {cuts.length} corte{cuts.length === 1 ? "" : "s"}</span>
              </span>
              <span className="font-black tabular-nums">{money(Math.abs(cashDiff))}</span>
            </summary>
            <ul className="ml-4 mt-1 space-y-0.5 text-xs text-zinc-400">
              {cuts.map((c) => (
                <li key={c.folio}>
                  {new Date(c.closedAt).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" })} · {c.folio}:{" "}
                  <span className={c.difference < 0 ? "text-red-300" : "text-emerald-300"}>
                    {c.difference < 0 ? "faltante" : "sobrante"} {money(Math.abs(c.difference))}
                  </span>
                  {c.reason ? ` (${c.reason})` : ""}
                </li>
              ))}
              <li className="text-zinc-600">Suma de los cortes de {periodName}; ya está restado en la utilidad.</li>
            </ul>
          </details>
        </li>
      )}
      <Line sign="=" label={<>Utilidad <span className="text-xs font-normal text-zinc-500">(margen neto {pct(netMargin)})</span></>} amount={net} money={money} strong />
    </ul>
  );
}
