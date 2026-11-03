"use client";
import { ask } from "@/components/layout/Dialogs";
/**
 * Configuración → Asistencia: horas trabajadas por empleado y día según el
 * checador (bpos.com.mx/checador), con corrección de registros y
 * exportación a Excel.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import { addAuditEvent } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { formatHours, getPunches, savePunches, TIMECLOCK_EVENT, workDays, type Punch } from "@/lib/timeclock";
import { getUsers } from "@/lib/users";
import { downloadXlsx } from "@/lib/xlsx";

const input = "rounded-xl border border-zinc-800 bg-black px-3 py-2 text-white";
const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : "—");
const dayLabel = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });

export default function AsistenciaPage() {
  const [punches, setPunches] = useState<Punch[]>([]);
  const [users, setUsers] = useState<ReturnType<typeof getUsers>>([]);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // lunes de esta semana
    return isoDate(d);
  });
  const [to, setTo] = useState(() => isoDate(new Date()));
  const [userFilter, setUserFilter] = useState("");
  const [manual, setManual] = useState({ userId: "", type: "entrada", at: "" });
  const current = getCurrentUser();

  useEffect(() => {
    const sync = () => {
      setPunches(getPunches());
      setUsers(getUsers());
    };
    sync();
    window.addEventListener(TIMECLOCK_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(TIMECLOCK_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const range = useMemo(() => ({ from: new Date(`${from}T00:00:00`), to: new Date(`${to}T23:59:59`) }), [from, to]);
  const days = useMemo(() => workDays(punches, range.from, range.to).filter((d) => !userFilter || String(d.userId) === userFilter), [punches, range, userFilter]);
  const totals = useMemo(() => {
    const map = new Map<number, { name: string; hours: number; days: Set<string> }>();
    for (const d of days) {
      const t = map.get(d.userId) || { name: d.userName, hours: 0, days: new Set<string>() };
      t.hours += d.hours;
      t.days.add(d.date);
      map.set(d.userId, t);
    }
    return [...map.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, "es"));
  }, [days]);
  const rangePunches = useMemo(
    () => punches.filter((p) => Date.parse(p.at) >= range.from.getTime() && Date.parse(p.at) <= range.to.getTime() && (!userFilter || String(p.userId) === userFilter)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
    [punches, range, userFilter]
  );

  async function remove(p: Punch) {
    if (!(await ask(`¿Borrar la ${p.type} de ${p.userName} del ${new Date(p.at).toLocaleString("es-MX")}?`, { ok: "Borrar" }))) return;
    savePunches(punches.filter((x) => x.id !== p.id));
    addAuditEvent({ category: "Seguridad", action: "timeclock.deleted", description: `${current.name} borró la ${p.type} de ${p.userName} (${new Date(p.at).toLocaleString("es-MX")})`, userId: String(current.id), userName: current.name, entityId: p.id });
  }

  function addManual() {
    const user = users.find((u) => String(u.id) === manual.userId);
    if (!user || !manual.at) return alert("Elige el empleado y la fecha y hora.");
    const at = new Date(manual.at);
    if (Number.isNaN(at.getTime())) return alert("Fecha u hora no válida.");
    const punch: Punch = { id: `chk-${Date.now().toString(36)}-m`, userId: user.id, userName: user.name, type: manual.type as Punch["type"], at: at.toISOString(), note: "Capturado a mano", editedBy: current.name };
    savePunches([...punches, punch]);
    addAuditEvent({ category: "Seguridad", action: "timeclock.manual", description: `${current.name} capturó a mano la ${punch.type} de ${user.name} (${at.toLocaleString("es-MX")})`, userId: String(current.id), userName: current.name, entityId: punch.id });
    setManual({ userId: "", type: "entrada", at: "" });
  }

  function exportXlsx() {
    downloadXlsx(`asistencia-${from}-a-${to}.xlsx`, [
      { name: "Horas por empleado", rows: [["Empleado", "Días", "Horas"], ...totals.map(([, t]) => [t.name, t.days.size, Math.round(t.hours * 100) / 100])] },
      { name: "Jornadas", rows: [["Empleado", "Fecha", "Entrada", "Salida", "Horas"], ...days.map((d) => [d.userName, d.date, time(d.in), d.open ? "(abierta)" : time(d.out), Math.round(d.hours * 100) / 100])] },
      { name: "Registros", rows: [["Empleado", "Tipo", "Fecha y hora", "Nota"], ...rangePunches.map((p) => [p.userName, p.type, new Date(p.at).toLocaleString("es-MX"), p.note || ""])] },
    ]);
  }

  return (
    <RequireRole allow={["Admin", "Gerente"]}>
      <AppShell title="Asistencia" subtitle="Entradas, salidas y horas trabajadas según el checador.">
        <div className="space-y-6">
          <section className="flex flex-wrap items-end gap-3 rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
            <label className="text-sm font-bold text-zinc-400">
              Desde
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${input} mt-1 block`} />
            </label>
            <label className="text-sm font-bold text-zinc-400">
              Hasta
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${input} mt-1 block`} />
            </label>
            <label className="text-sm font-bold text-zinc-400">
              Empleado
              <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className={`${input} mt-1 block`}>
                <option value="">Todos</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={exportXlsx} disabled={!days.length} className="rounded-xl border border-orange-500 px-4 py-2 font-black text-orange-300 disabled:opacity-40">
              📊 Exportar a Excel
            </button>
            <Link href="/checador" className="rounded-xl bg-orange-500 px-4 py-2 font-black text-black">
              ⏱️ Abrir el checador
            </Link>
            <p className="w-full text-xs text-zinc-500">El checador va en la tablet o computadora del local: bpos.com.mx/checador. Cada empleado marca con su PIN de B-POS.</p>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {totals.map(([id, t]) => (
              <div key={id} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                <p className="truncate font-black">{t.name}</p>
                <p className="mt-1 text-2xl font-black text-orange-400">{formatHours(t.hours)}</p>
                <p className="text-xs text-zinc-500">
                  {t.days.size} {t.days.size === 1 ? "día" : "días"} · {formatHours(t.days.size ? t.hours / t.days.size : 0)} por día
                </p>
              </div>
            ))}
            {!totals.length && <p className="rounded-2xl border border-dashed border-zinc-800 p-6 text-center text-zinc-500 sm:col-span-2 lg:col-span-4">Sin registros en estas fechas.</p>}
          </section>

          {days.length > 0 && (
            <section className="overflow-x-auto rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
              <h2 className="text-lg font-black text-orange-500">Jornadas</h2>
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-zinc-500">
                  <tr>
                    <th className="py-2 pr-3">Empleado</th>
                    <th className="py-2 pr-3">Día</th>
                    <th className="py-2 pr-3">Entrada</th>
                    <th className="py-2 pr-3">Salida</th>
                    <th className="py-2 pr-3">Horas</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d, i) => (
                    <tr key={`${d.userId}-${d.in || d.out}-${i}`} className="border-t border-zinc-900">
                      <td className="py-2 pr-3 font-bold">{d.userName}</td>
                      <td className="py-2 pr-3 capitalize">{dayLabel(d.date)}</td>
                      <td className="py-2 pr-3">{time(d.in)}</td>
                      <td className="py-2 pr-3">{d.open ? <span className="text-emerald-400">sin salida (en turno)</span> : time(d.out)}</td>
                      <td className="py-2 pr-3 font-black">{formatHours(d.hours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
            <h2 className="text-lg font-black text-orange-500">Corregir registros</h2>
            <p className="mt-1 text-sm text-zinc-400">Si alguien olvidó marcar, captura aquí su entrada o salida. Todo queda en la bitácora.</p>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <select value={manual.userId} onChange={(e) => setManual({ ...manual, userId: e.target.value })} className={input}>
                <option value="">Empleado</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              <select value={manual.type} onChange={(e) => setManual({ ...manual, type: e.target.value })} className={input}>
                <option value="entrada">Entrada</option>
                <option value="salida">Salida</option>
              </select>
              <input type="datetime-local" value={manual.at} onChange={(e) => setManual({ ...manual, at: e.target.value })} className={input} />
              <button onClick={addManual} className="rounded-xl bg-orange-500 px-4 py-2 font-black text-black">
                Agregar
              </button>
            </div>
            {rangePunches.length > 0 && (
              <ul className="mt-4 max-h-72 space-y-1 overflow-y-auto text-sm">
                {rangePunches.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-900 px-3 py-2">
                    <span>
                      <b>{p.userName}</b> · {p.type === "entrada" ? "🟢 entrada" : "🔴 salida"} · {new Date(p.at).toLocaleString("es-MX", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      {p.note ? <span className="ml-2 text-xs text-zinc-500">({p.note})</span> : null}
                    </span>
                    <button onClick={() => remove(p)} className="text-xs font-black text-red-400">
                      Borrar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </AppShell>
    </RequireRole>
  );
}
