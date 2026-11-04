"use client";
/**
 * Reportes → Empleados y propinas: ventas, ticket promedio, propinas y horas
 * por empleado, y el reparto de propinas del periodo (cada quien la suya,
 * por igual, por horas del checador o por puntos), con vista previa, notas
 * e historial. Solo se guarda algo al confirmar un reparto.
 */
import { useEffect, useMemo, useState } from "react";
import { ask, notify } from "@/components/layout/Dialogs";
import { canManageCash, getCurrentUser } from "@/lib/auth";
import type { DateRange, ReportOrder } from "@/lib/reports";
import {
  getTipPayouts,
  NO_EMPLOYEE,
  saveTipPayout,
  splitTips,
  staffReport,
  TIP_MODES,
  TIP_PAYOUTS_EVENT,
  type StaffRow,
  type TipMode,
  type TipPayout,
} from "@/lib/staff";

const money = (v: number) => `$${(Number(v) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hrs = (h: number) => `${(Number(h) || 0).toLocaleString("es-MX", { maximumFractionDigits: 1 })} h`;
const day = (d: Date) => d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });

export function useStaffRows(orders: ReportOrder[] | undefined, range: DateRange) {
  return useMemo(() => (orders ? staffReport(orders, range) : []), [orders, range]);
}

export function StaffTab({ orders, range, rangeLabel }: { orders: ReportOrder[]; range: DateRange; rangeLabel: string }) {
  const rows = useStaffRows(orders, range);
  const people = rows.filter((r) => r.name !== NO_EMPLOYEE);
  const unassigned = rows.find((r) => r.name === NO_EMPLOYEE);
  const totals = rows.reduce((t, r) => ({ orders: t.orders + r.orders, sales: t.sales + r.sales, tips: t.tips + r.tips, hours: t.hours + r.hours }), { orders: 0, sales: 0, tips: 0, hours: 0 });

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6 xl:col-span-2">
        <h2 className="text-lg font-black">Por empleado</h2>
        <p className="mt-1 text-sm text-zinc-400">
          La venta se le cuenta al mesero que la tomó o a quien la capturó en el POS. Las horas salen del checador. No incluye pedidos de DiDi, Uber ni Rappi.
        </p>
        {rows.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">Sin ventas ni horas en el periodo.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="pb-2">Empleado</th>
                  <th className="pb-2 text-right">Pedidos</th>
                  <th className="pb-2 text-right">Venta</th>
                  <th className="pb-2 text-right">Ticket promedio</th>
                  <th className="pb-2 text-right">Artículos</th>
                  <th className="pb-2 text-right">Propinas</th>
                  <th className="pb-2 text-right">Horas</th>
                  <th className="pb-2 text-right">Venta por hora</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} className={`border-t border-zinc-900 ${r.name === NO_EMPLOYEE ? "text-zinc-500" : ""}`}>
                    <td className="py-2 font-bold">{r.name}</td>
                    <td className="py-2 text-right">{r.orders}</td>
                    <td className="py-2 text-right">{money(r.sales)}</td>
                    <td className="py-2 text-right">{money(r.average)}</td>
                    <td className="py-2 text-right">{r.items}</td>
                    <td className="py-2 text-right text-emerald-300">{money(r.tips)}</td>
                    <td className="py-2 text-right">{r.hours ? hrs(r.hours) : "—"}</td>
                    <td className="py-2 text-right">{r.hours > 0 && r.sales > 0 ? money(r.sales / r.hours) : "—"}</td>
                  </tr>
                ))}
                <tr className="border-t border-zinc-700 font-black">
                  <td className="py-2">Total</td>
                  <td className="py-2 text-right">{totals.orders}</td>
                  <td className="py-2 text-right">{money(totals.sales)}</td>
                  <td className="py-2 text-right">{money(totals.orders ? totals.sales / totals.orders : 0)}</td>
                  <td className="py-2" />
                  <td className="py-2 text-right text-emerald-300">{money(totals.tips)}</td>
                  <td className="py-2 text-right">{hrs(totals.hours)}</td>
                  <td className="py-2" />
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {unassigned && unassigned.orders > 0 && (
          <p className="mt-3 text-xs text-zinc-500">
            &quot;{NO_EMPLOYEE}&quot;: ventas de antes de esta versión que no dicen quién las hizo. Desde hoy cada venta guarda quién la capturó y quién la cobró.
          </p>
        )}
      </section>

      <TipSplit people={people} unassignedTips={unassigned?.tips || 0} range={range} rangeLabel={rangeLabel} />
      <TipHistory />
    </div>
  );
}

function TipSplit({ people, unassignedTips, range, rangeLabel }: { people: StaffRow[]; unassignedTips: number; range: DateRange; rangeLabel: string }) {
  const [mode, setMode] = useState<TipMode>("directas");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [points, setPoints] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const user = getCurrentUser();
  const canSave = canManageCash(user.role);

  const chosen = people.filter((p) => !excluded.has(p.name));
  // Las propinas sin empleado entran a la bolsa (en "cada quien la suya" no son de nadie)
  const extra = mode === "directas" ? 0 : unassignedTips;
  const split = splitTips(
    mode,
    chosen.map((p, i) => ({ name: p.name, tips: p.tips + (i === 0 ? extra : 0), hours: p.hours, points: points[p.name] ?? 1 }))
  );
  const pool = mode !== "directas";

  async function save() {
    if (!split.lines.length || split.problem) return;
    if (!(await ask(`¿Guardar el reparto de ${money(split.total)} (${rangeLabel})? Queda en el historial.`, { ok: "Guardar reparto" }))) return;
    saveTipPayout({
      createdBy: user.name,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      mode,
      total: split.total,
      notes,
      lines: split.lines,
    });
    setNotes("");
    notify("Reparto guardado en el historial.");
  }

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
      <h2 className="text-lg font-black">💰 Repartir propinas</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Propinas del periodo ({rangeLabel}): <b className="text-emerald-300">{money(people.reduce((s, p) => s + p.tips, 0) + unassignedTips)}</b>
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {(Object.keys(TIP_MODES) as TipMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-2xl border px-3 py-2 text-sm font-black ${mode === m ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-800 bg-black text-zinc-300"}`}
          >
            {TIP_MODES[m].label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-zinc-500">{TIP_MODES[mode].hint}</p>

      {people.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">No hay empleados con ventas u horas en el periodo.</p>
      ) : (
        <div className="mt-4 divide-y divide-zinc-900 rounded-2xl border border-zinc-800">
          {people.map((p) => {
            const inSplit = !excluded.has(p.name);
            const line = split.lines.find((l) => l.name === p.name);
            return (
              <div key={p.name} className={`flex flex-wrap items-center gap-3 px-4 py-3 text-sm ${inSplit ? "" : "opacity-50"}`}>
                <label className="flex min-w-0 flex-1 items-center gap-2 font-bold">
                  <input
                    type="checkbox"
                    checked={inSplit}
                    onChange={(e) =>
                      setExcluded((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.delete(p.name);
                        else next.add(p.name);
                        return next;
                      })
                    }
                    className="h-5 w-5 accent-orange-500"
                  />
                  <span className="truncate">{p.name}</span>
                </label>
                <span className="text-xs text-zinc-500">
                  juntó {money(p.tips)} · {p.hours ? hrs(p.hours) : "sin horas"}
                </span>
                {mode === "puntos" && inSplit && (
                  <label className="flex items-center gap-1 text-xs text-zinc-400">
                    Puntos
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={points[p.name] ?? 1}
                      onChange={(e) => setPoints((prev) => ({ ...prev, [p.name]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))}
                      className="w-16 rounded-xl border border-zinc-800 bg-black px-2 py-1 text-white"
                    />
                  </label>
                )}
                <span className="w-24 text-right text-base font-black text-emerald-300">{inSplit ? money(line?.amount || 0) : "—"}</span>
              </div>
            );
          })}
        </div>
      )}
      {pool && unassignedTips > 0 && <p className="mt-2 text-xs text-zinc-500">Incluye {money(unassignedTips)} de propinas de ventas sin empleado registrado.</p>}
      {split.problem && people.length > 0 && <p className="mt-3 text-sm font-bold text-yellow-300">{split.problem}</p>}

      <label className="mt-4 block text-sm font-bold text-zinc-400">
        Notas (opcional)
        <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Ej. se pagó en efectivo al cierre del sábado" className="mt-1 w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white" />
      </label>
      {canSave ? (
        <button
          onClick={() => void save()}
          disabled={!split.lines.length || Boolean(split.problem) || split.total <= 0}
          className="mt-4 w-full rounded-2xl bg-orange-500 py-3 font-black text-black disabled:opacity-40"
        >
          Guardar reparto · {money(split.total)}
        </button>
      ) : (
        <p className="mt-4 text-sm text-zinc-500">Solo el administrador o el gerente guardan repartos.</p>
      )}
    </section>
  );
}

function TipHistory() {
  const [list, setList] = useState<TipPayout[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const load = () => setList(getTipPayouts());
    load();
    window.addEventListener(TIP_PAYOUTS_EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(TIP_PAYOUTS_EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, []);

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
      <h2 className="text-lg font-black">🗂️ Historial de repartos</h2>
      {list.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">Todavía no hay repartos guardados.</p>
      ) : (
        <div className="mt-4 space-y-2">
          {list.slice(0, 60).map((p) => (
            <div key={p.id} className="rounded-2xl border border-zinc-800 bg-black">
              <button onClick={() => setOpen(open === p.id ? null : p.id)} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left text-sm">
                <span>
                  <b>{money(p.total)}</b> · {TIP_MODES[p.mode]?.label || p.mode}
                  <span className="block text-xs text-zinc-500">
                    {day(new Date(p.from))} – {day(new Date(new Date(p.to).getTime() - 1))} · guardó {p.createdBy} el {new Date(p.createdAt).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                </span>
                <span className="text-zinc-500">{open === p.id ? "▲" : "▼"}</span>
              </button>
              {open === p.id && (
                <div className="border-t border-zinc-900 px-4 py-3 text-sm">
                  {p.lines.map((l) => (
                    <p key={l.name} className="flex justify-between gap-3">
                      <span>
                        {l.name}
                        <span className="ml-2 text-xs text-zinc-500">
                          {p.mode === "horas" ? hrs(l.hours) : p.mode === "puntos" ? `${l.points} pts` : `juntó ${money(l.tips)}`}
                        </span>
                      </span>
                      <b className="text-emerald-300">{money(l.amount)}</b>
                    </p>
                  ))}
                  {p.notes && <p className="mt-2 text-xs text-zinc-400">📝 {p.notes}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
