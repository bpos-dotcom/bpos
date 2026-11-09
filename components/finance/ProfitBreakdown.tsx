"use client";
/**
 * Finanzas → de dónde sale la utilidad, renglón por renglón: ingresos locales
 * (efectivo, tarjeta, transferencia...), ingresos por apps (lo estimado por
 * sus comisiones contra el depósito real), costo de lo vendido, gastos fijos y
 * los faltantes o sobrantes de caja. El detalle del food cost, de los gastos
 * fijos y de los cortes se abre en una ventanita a un lado.
 */
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Part = { label: string; amount: number };
export type AppIncome = { name: string; deposited: number; expected: number | null; pending: number };
type Cut = { folio: string; closedAt: string; difference: number; reason: string };
/** Un gasto fijo: lo que cuesta al mes y lo que le toca al periodo */
export type FixedPart = { name: string; category: string; monthly: number; amount: number };
export type FoodCostInfo = {
  pct: number;
  itemsSold: number;
  orders: number;
  localCost: number;
  appCost: number;
  coverage: number;
  /** Productos que más suman al costo */
  top: { label: string; quantity: number; cost: number; sales: number }[];
  /** Productos vendidos sin costo de receta */
  noCost: string[];
};

/** Botoncito que abre una ventanita centrada en la pantalla; se cierra al tocar fuera, con ✕ o con Esc */
function Popover({ label, title, children, tone = "text-zinc-400" }: { label: ReactNode; title: string; children: ReactNode; tone?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-expanded={open} className={`ml-2 inline-block rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] font-black hover:border-orange-500 hover:text-orange-300 ${open ? "border-orange-500 text-orange-300" : tone}`}>
        {label}
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
            <div role="dialog" aria-label={title} className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-3xl border border-zinc-700 bg-zinc-950 p-5 text-left text-sm font-normal text-zinc-300 shadow-2xl shadow-black" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-lg font-black text-white">{title}</p>
                <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-zinc-800 px-3 py-1 font-black text-zinc-400 hover:text-white" aria-label="Cerrar">
                  ✕
                </button>
              </div>
              <div className="mt-3 space-y-3">{children}</div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function Line({ sign, label, amount, money, strong, tone, extra, children }: { sign?: string; label: ReactNode; amount: number; money: (n: number) => string; strong?: boolean; tone?: string; extra?: ReactNode; children?: ReactNode }) {
  return (
    <li className="py-1.5">
      <div className={`flex items-baseline justify-between gap-3 ${strong ? "font-black text-white" : tone || "text-zinc-300"}`}>
        <span>
          {sign && <span className="mr-1 inline-block w-3 text-zinc-500">{sign}</span>}
          {label}
          {extra}
        </span>
        <span className="font-black tabular-nums">{money(amount)}</span>
      </div>
      {children && <div className="ml-4 mt-0.5 space-y-0.5 text-xs text-zinc-500">{children}</div>}
    </li>
  );
}

const Row = ({ left, right, strong }: { left: ReactNode; right: ReactNode; strong?: boolean }) => (
  <div className={`flex items-baseline justify-between gap-3 ${strong ? "font-black text-white" : ""}`}>
    <span>{left}</span>
    <span className="shrink-0 tabular-nums">{right}</span>
  </div>
);

export function ProfitBreakdown({
  local,
  apps,
  appsTotal,
  cost,
  food,
  fixed,
  fixedTotal,
  extraTotal,
  cashSpent,
  cashDiff,
  cuts,
  net,
  netMargin,
  periodName,
  periodDays,
  money,
  pct,
  onWhyCost,
}: {
  local: Part[];
  apps: AppIncome[];
  appsTotal: number;
  cost: number;
  food: FoodCostInfo;
  fixed: FixedPart[];
  fixedTotal: number;
  extraTotal: number;
  cashSpent: number;
  cashDiff: number;
  cuts: Cut[];
  net: number;
  netMargin: number;
  periodName: string;
  /** Días del periodo (para la parte de los gastos fijos) */
  periodDays: number;
  money: (n: number) => string;
  pct: (n: number) => string;
  onWhyCost?: () => void;
}) {
  const localTotal = local.reduce((s, p) => s + p.amount, 0);
  const lowCoverage = food.coverage < 90;
  return (
    <ul className="mt-3 max-w-2xl divide-y divide-zinc-800/70 rounded-2xl border border-zinc-800 bg-black/40 px-4 py-1 text-sm">
      <Line label="Ingresos" amount={localTotal + appsTotal} money={money} strong>
        <Row left={<span className="text-zinc-300">🏪 Ingresos locales:</span>} right={<span className="text-zinc-300">{money(localTotal)}</span>} />
        {local.length > 0 && <p className="ml-5">{local.map((p) => `${p.label} ${money(p.amount)}`).join(" · ")}</p>}
        {(appsTotal > 0.5 || apps.length > 0) && (
          <>
            <div className="pt-1">
              <Row left={<span className="text-zinc-300">🛵 Ingresos por apps:</span>} right={<span className="text-zinc-300">{money(appsTotal)}</span>} />
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

      <Line
        sign="−"
        label="Costo de lo vendido"
        amount={cost}
        money={money}
        extra={
          <Popover label={<>{lowCoverage ? "⚠️ " : ""}Food cost {pct(food.pct)}</>} title={`🍔 Food cost: ${pct(food.pct)}`} tone={lowCoverage ? "text-yellow-300" : undefined}>
            <p className="text-zinc-400">Lo que costó la comida de lo vendido, según las recetas. Lo sano es 28% a 35% de los ingresos.</p>
            <div className="space-y-1 rounded-xl bg-black p-3">
              <Row left="Productos vendidos" right={<b>{food.itemsSold.toLocaleString("es-MX")}</b>} />
              <Row left="Pedidos" right={food.orders.toLocaleString("es-MX")} />
              <Row left="Costo de recetas (local y menú)" right={money(food.localCost)} />
              {food.appCost > 0.5 && <Row left="Costo de recetas (apps)" right={money(food.appCost)} />}
              <Row left="Costo de lo vendido" right={money(cost)} strong />
            </div>
            {food.top.length > 0 && (
              <div>
                <p className="font-black text-zinc-200">Lo que más suma al costo</p>
                {food.top.map((t) => (
                  <Row key={t.label} left={`${t.label} × ${t.quantity}`} right={<>{money(t.cost)} <span className="text-zinc-500">({pct(t.sales > 0 ? (t.cost / t.sales) * 100 : 0)})</span></>} />
                ))}
              </div>
            )}
            {lowCoverage && (
              <p className="rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-2 text-yellow-100">
                ⚠️ Solo el {pct(food.coverage)} de lo vendido tiene receta con costo. Lo que no tiene receta cuenta como costo $0 y la utilidad se ve más alta de lo real. Completa tus recetas en Configuración → Recetas.
                {food.noCost.length > 0 && <span className="mt-1 block text-yellow-200/80">Sin costo: {food.noCost.slice(0, 8).join(", ")}{food.noCost.length > 8 ? ` y ${food.noCost.length - 8} más` : ""}.</span>}
              </p>
            )}
            {onWhyCost && (
              <button type="button" onClick={onWhyCost} className="font-bold text-zinc-400 underline-offset-2 hover:text-orange-400 hover:underline">
                🔎 Ver qué ingredientes suman más
              </button>
            )}
          </Popover>
        }
      />

      <Line
        sign="−"
        label="Gastos fijos"
        amount={fixedTotal}
        money={money}
        extra={
          fixed.length > 0 && (
            <Popover label="Ver detalle" title={`🏠 Gastos fijos de ${periodName}`}>
              <p className="text-zinc-400">
                Lo que le toca a {periodName} ({periodDays} día{periodDays === 1 ? "" : "s"}) de cada gasto fijo.
              </p>
              <div className="space-y-1.5 rounded-2xl bg-black p-3">
                {fixed.map((f) => (
                  <Row
                    key={`${f.name}-${f.category}`}
                    left={
                      <>
                        <b className="text-zinc-200">{f.name}</b> <span className="text-xs text-zinc-500">{f.category}</span>
                      </>
                    }
                    right={<b className="text-white">{money(f.amount)}</b>}
                  />
                ))}
                <div className="border-t border-zinc-800 pt-1">
                  <Row left="Total" right={money(fixedTotal)} strong />
                </div>
              </div>
            </Popover>
          )
        }
      />
      {extraTotal > 0.5 && <Line sign="−" label="Gastos sueltos" amount={extraTotal} money={money} />}
      {cashSpent > 0.5 && <Line sign="−" label="Gastos pagados con la caja" amount={cashSpent} money={money} />}

      {cuts.length > 0 && (
        <Line
          sign={cashDiff < 0 ? "−" : "+"}
          label={cashDiff < 0 ? "Faltantes de caja" : cashDiff > 0 ? "Sobrantes de caja" : "Diferencias de caja (se compensan)"}
          amount={Math.abs(cashDiff)}
          money={money}
          tone={cashDiff < 0 ? "text-red-300" : "text-emerald-300"}
          extra={
            <Popover label={`Ver ${cuts.length} corte${cuts.length === 1 ? "" : "s"}`} title={`💵 Cortes de caja de ${periodName}`}>
              <ul className="space-y-1 rounded-xl bg-black p-3">
                {cuts.map((c) => (
                  <li key={c.folio}>
                    <Row
                      left={
                        <>
                          {new Date(c.closedAt).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" })} · <span className="text-zinc-500">{c.folio}</span>
                          {c.reason ? <span className="block text-zinc-500">{c.reason}</span> : null}
                        </>
                      }
                      right={<span className={c.difference < 0 ? "text-red-300" : "text-emerald-300"}>{c.difference < 0 ? "−" : "+"}{money(Math.abs(c.difference))}</span>}
                    />
                  </li>
                ))}
                <li className="border-t border-zinc-800 pt-1">
                  <Row left={cashDiff < 0 ? "Faltó en total" : "Sobró en total"} right={money(Math.abs(cashDiff))} strong />
                </li>
              </ul>
              <p className="text-zinc-500">Ya está restado (o sumado) en la utilidad.</p>
            </Popover>
          }
        />
      )}
      <Line sign="=" label={<>Utilidad <span className="text-xs font-normal text-zinc-500">(margen neto {pct(netMargin)})</span></>} amount={net} money={money} strong />
    </ul>
  );
}
