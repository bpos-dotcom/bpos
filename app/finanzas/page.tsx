"use client";
/**
 * Finanzas (Entrega 4): con las ventas del mes, el costo de lo vendido
 * (recetas y compras), los gastos fijos y los gastos sueltos, B-POS dice
 * cuánto ganas de verdad, tu food cost y cuánto tienes que vender para no
 * perder (punto de equilibrio).
 */
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import {
  EXPENSE_CATEGORIES,
  FINANCE_EVENT,
  addExpense,
  addFixedExpense,
  breakEven,
  getExpenses,
  getFixedExpenses,
  removeExpense,
  removeFixedExpense,
  updateFixedExpense,
  type Expense,
  type FixedExpense,
} from "@/lib/finance";
import { buildReport, loadReportSources, presetRange, type DateRange } from "@/lib/reports";

const card = "rounded-3xl border border-zinc-800 bg-zinc-950 p-5";
const input = "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white";
const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const pct = (n: number) => `${(Number.isFinite(n) ? n : 0).toFixed(1)}%`;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function Kpi({ title, value, hint, tone = "" }: { title: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className={card}>
      <p className="text-sm text-zinc-400">{title}</p>
      <p className={`text-3xl font-black ${tone}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

export default function FinanzasPage() {
  const [period, setPeriod] = useState<"mes" | "mes-pasado">("mes");
  const [fixed, setFixed] = useState<FixedExpense[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [version, setVersion] = useState(0);
  const [form, setForm] = useState({ name: "", category: "Renta", amount: "" });
  const [extra, setExtra] = useState({ date: ymd(new Date()), concept: "", amount: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    const load = () => {
      setFixed(getFixedExpenses());
      setExpenses(getExpenses());
      setVersion((v) => v + 1);
    };
    load();
    window.addEventListener(FINANCE_EVENT, load);
    window.addEventListener("bpos:orders-updated", load);
    return () => {
      window.removeEventListener(FINANCE_EVENT, load);
      window.removeEventListener("bpos:orders-updated", load);
    };
  }, []);

  const range: DateRange = useMemo(() => presetRange(period), [period]);
  const report = useMemo(() => (version ? buildReport(loadReportSources(), range) : null), [version, range]);

  const k = report?.kpis;
  const now = new Date();
  const monthDays = new Date(range.from.getFullYear(), range.from.getMonth() + 1, 0).getDate();
  const isCurrent = period === "mes";
  const daysElapsed = isCurrent ? Math.max(1, now.getDate()) : monthDays;
  const fixedTotal = fixed.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const monthEnd = ymd(new Date(range.from.getFullYear(), range.from.getMonth() + 1, 1));
  const monthExpenses = expenses.filter((e) => e.date >= ymd(range.from) && e.date < monthEnd);
  const extraTotal = monthExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const sales = k?.sales || 0;
  const cost = k?.cost || 0;
  const gross = k?.profit || 0;
  const grossMargin = sales > 0 ? (gross / sales) * 100 : 0;
  const foodCost = sales > 0 ? (cost / sales) * 100 : 0;
  const net = gross - fixedTotal - extraTotal;
  const netMargin = sales > 0 ? (net / sales) * 100 : 0;
  const equilibrium = breakEven(fixedTotal + extraTotal, grossMargin);
  const dailyNeeded = equilibrium ? equilibrium / monthDays : 0;
  const projection = isCurrent ? (sales / daysElapsed) * monthDays : sales;
  const projectedNet = isCurrent ? (projection * grossMargin) / 100 - fixedTotal - extraTotal : net;
  const progress = equilibrium ? Math.min(100, (sales / equilibrium) * 100) : 0;
  // Día del mes en que (al ritmo actual) ya se cubren los gastos
  const coverDay = equilibrium && sales > 0 ? Math.ceil(equilibrium / (sales / daysElapsed)) : null;

  function addFixed() {
    setError("");
    try {
      addFixedExpense(form.name, form.category, Number(form.amount) || 0);
      setForm({ name: "", category: form.category, amount: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo.");
    }
  }

  function addExtra() {
    setError("");
    try {
      addExpense(extra.date, extra.concept, Number(extra.amount) || 0);
      setExtra({ ...extra, concept: "", amount: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo.");
    }
  }

  return (
    <AppShell title="Finanzas" subtitle="Cuánto ganas de verdad: ventas, costo de lo vendido, gastos fijos y punto de equilibrio.">
      <div className="space-y-6">
        <div className="flex gap-2">
          {(
            [
              ["mes", "Este mes"],
              ["mes-pasado", "Mes pasado"],
            ] as const
          ).map(([key, text]) => (
            <button key={key} onClick={() => setPeriod(key)} className={`rounded-2xl border px-5 py-2 font-black ${period === key ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-800 text-zinc-300"}`}>
              {text}
            </button>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Kpi title="Ventas" value={money(sales)} hint={`${k?.orders || 0} pedidos · ticket ${money(k?.averageTicket || 0)}`} />
          <Kpi
            title="Food cost (costo de lo vendido)"
            value={pct(foodCost)}
            hint={`${money(cost)} · lo sano en restaurantes es 28% a 35%`}
            tone={foodCost > 35 ? "text-red-400" : foodCost > 0 ? "text-emerald-400" : ""}
          />
          <Kpi title="Utilidad bruta" value={money(gross)} hint={`Margen ${pct(grossMargin)} (ventas menos costo)`} />
          <Kpi title="Gastos del mes" value={money(fixedTotal + extraTotal)} hint={`Fijos ${money(fixedTotal)} · sueltos ${money(extraTotal)}`} />
        </div>

        <div className={`${card} ${net >= 0 ? "border-emerald-500/50" : "border-red-500/50"}`}>
          <p className="text-sm text-zinc-400">Utilidad real {isCurrent ? "hasta hoy" : "del mes"}</p>
          <p className={`text-5xl font-black ${net >= 0 ? "text-emerald-400" : "text-red-400"}`}>{money(net)}</p>
          <p className="mt-1 text-sm text-zinc-400">
            Margen neto {pct(netMargin)} · ventas {money(sales)} − costo {money(cost)} − gastos {money(fixedTotal + extraTotal)}
          </p>
          {isCurrent && sales > 0 && (
            <p className="mt-2 text-sm">
              Si sigues al mismo ritmo, cierras el mes con <b>{money(projection)}</b> de venta y una utilidad de{" "}
              <b className={projectedNet >= 0 ? "text-emerald-400" : "text-red-400"}>{money(projectedNet)}</b>.
            </p>
          )}
          {(k?.costCoverage ?? 100) < 90 && sales > 0 && (
            <p className="mt-3 rounded-2xl border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs text-yellow-100">
              ⚠️ Solo el {pct(k?.costCoverage || 0)} de lo vendido tiene receta con costo. Lo que no tiene receta cuenta como costo $0 y la utilidad se ve más alta de lo real.
              Completa tus recetas en Configuración → Recetas.
            </p>
          )}
        </div>

        <div className={card}>
          <h2 className="text-lg font-black">⚖️ Punto de equilibrio</h2>
          {!fixedTotal && !extraTotal ? (
            <p className="mt-2 text-sm text-zinc-400">Agrega tus gastos fijos abajo para saber cuánto tienes que vender al mes para no perder.</p>
          ) : !equilibrium ? (
            <p className="mt-2 text-sm text-zinc-400">Todavía no hay ventas con costo en este periodo para calcularlo.</p>
          ) : (
            <>
              <p className="mt-2 text-sm text-zinc-300">
                Para cubrir {money(fixedTotal + extraTotal)} de gastos, con tu margen de {pct(grossMargin)}, necesitas vender <b className="text-white">{money(equilibrium)}</b> al mes
                (unos <b className="text-white">{money(dailyNeeded)}</b> diarios).
              </p>
              <div className="mt-4 h-5 overflow-hidden rounded-full bg-zinc-800">
                <div className={`h-full rounded-full ${progress >= 100 ? "bg-emerald-500" : "bg-orange-500"}`} style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-2 text-sm">
                {progress >= 100 ? (
                  <b className="text-emerald-400">✅ Ya cubriste tus gastos{isCurrent && coverDay ? ` (desde el día ${Math.min(coverDay, now.getDate())})` : ""}: lo que vendas de aquí en adelante es ganancia.</b>
                ) : (
                  <>
                    Llevas {pct(progress)}. Te faltan <b className="text-white">{money(equilibrium - sales)}</b>
                    {isCurrent && coverDay ? (coverDay <= monthDays ? `; a este ritmo los cubres el día ${coverDay}.` : "; a este ritmo no alcanzas este mes.") : "."}
                  </>
                )}
              </p>
            </>
          )}
        </div>

        {error && <p className="text-sm font-bold text-red-300">{error}</p>}

        <div className="grid gap-6 xl:grid-cols-2">
          <section className={card}>
            <h2 className="text-lg font-black">🏠 Gastos fijos (cada mes)</h2>
            <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_8rem_auto]">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Renta del local" className={input} />
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="rounded-2xl border border-zinc-800 bg-black px-3 py-3">
                {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
              <input type="number" min={0} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="$ al mes" className={input} />
              <button onClick={addFixed} className="rounded-2xl bg-orange-500 px-4 py-3 font-black text-black">Agregar</button>
            </div>
            <div className="mt-4 space-y-2">
              {fixed.map((e) => (
                <div key={e.id} className="flex items-center gap-2 rounded-2xl bg-black p-3 text-sm">
                  <span className="flex-1">
                    <b>{e.name}</b> <span className="text-xs text-zinc-500">{e.category}</span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    defaultValue={e.amount}
                    onBlur={(ev) => Number(ev.target.value) !== e.amount && updateFixedExpense(e.id, Number(ev.target.value) || 0)}
                    className="w-28 rounded-xl border border-zinc-800 bg-zinc-950 px-2 py-1 text-right"
                  />
                  <button onClick={() => removeFixedExpense(e.id)} className="rounded-xl px-2 text-red-300" aria-label="Quitar">✕</button>
                </div>
              ))}
              {fixed.length === 0 && <p className="text-sm text-zinc-500">Ej. renta, sueldos, luz, gas, internet, publicidad.</p>}
              {fixed.length > 0 && <p className="text-right text-sm font-black">Total al mes: {money(fixedTotal)}</p>}
            </div>
          </section>

          <section className={card}>
            <h2 className="text-lg font-black">🧾 Gastos sueltos del mes</h2>
            <p className="text-xs text-zinc-500">Lo que no se repite: una reparación, un evento, material. (Las compras de insumos ya cuentan en el costo de lo vendido.)</p>
            <div className="mt-3 grid gap-2 md:grid-cols-[9rem_1fr_7rem_auto]">
              <input type="date" value={extra.date} onChange={(e) => setExtra({ ...extra, date: e.target.value })} className={input} />
              <input value={extra.concept} onChange={(e) => setExtra({ ...extra, concept: e.target.value })} placeholder="Reparación del refri" className={input} />
              <input type="number" min={0} value={extra.amount} onChange={(e) => setExtra({ ...extra, amount: e.target.value })} placeholder="$" className={input} />
              <button onClick={addExtra} className="rounded-2xl bg-orange-500 px-4 py-3 font-black text-black">Agregar</button>
            </div>
            <div className="mt-4 space-y-2">
              {monthExpenses
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((e) => (
                  <div key={e.id} className="flex items-center gap-2 rounded-2xl bg-black p-3 text-sm">
                    <span className="w-24 text-xs text-zinc-500">{e.date}</span>
                    <span className="flex-1 font-bold">{e.concept}</span>
                    <span className="font-black">{money(e.amount)}</span>
                    <button onClick={() => removeExpense(e.id)} className="rounded-xl px-2 text-red-300" aria-label="Quitar">✕</button>
                  </div>
                ))}
              {monthExpenses.length === 0 && <p className="text-sm text-zinc-500">Sin gastos sueltos en este mes.</p>}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
