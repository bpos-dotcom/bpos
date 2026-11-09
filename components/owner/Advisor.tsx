"use client";
/**
 * App del dueño → ✨ Asesor con IA: con los números del negocio (ventas,
 * platillos, horas, gastos, clientes) arma el resumen de la semana, alertas
 * y consejos, y responde preguntas. Un análisis nuevo diario, cada 3 días o
 * cada semana (lo elige el dueño de B-POS); el chat, cuando quiera. Solo plan
 * Max (app/api/ai/asesor).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { aiFetch } from "@/lib/ai/client";
import { ADVISOR_PERIODS, advisorPeriodText, advisorRanges, buildMetrics, today, type AdvisorPeriod } from "@/lib/advisor-metrics";
import { syncAdvisorSnapshot } from "@/lib/advisor-sync";
import { asRefreshDays, dayLabel, REFRESH_OPTIONS, type RefreshDays } from "@/lib/ai/advisor-refresh";
import type { ReportOrder } from "@/lib/reports";

type Analysis = { resumen: string; alertas: { titulo: string; texto: string }[]; consejos: { titulo: string; texto: string }[] };
type Turn = { role: "user" | "assistant"; text: string };

const STORE = "asesor:analisis";
/** Periodo elegido en este dispositivo */
const PERIOD_STORE = "asesor:periodo";
const DEFAULT_PERIOD: AdvisorPeriod = { key: "semana" };
const SUGGESTED = ["¿Qué hago en mis días flojos?", "¿Qué platillo me deja más?", "¿Debería subir algún precio?", "¿Dónde puedo ahorrar?"];
/** loadOrders: trae de la nube los pedidos desde una fecha (los de la sucursal elegida), para periodos más largos */
export function Advisor({ orders, branchLabel, loadOrders }: { orders: ReportOrder[]; branchLabel: string; loadOrders?: (since: Date) => Promise<ReportOrder[] | null> }) {
  const [saved, setSaved] = useState<{ date: string; analysis: Analysis; period?: string } | null>(null);
  const [period, setPeriod] = useState<AdvisorPeriod>(DEFAULT_PERIOD);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [custom, setCustom] = useState({ from: "", to: "" });
  // Pedidos del periodo elegido (los del mes que trae la app no alcanzan para el mes pasado o toda la historia)
  const [periodOrders, setPeriodOrders] = useState<{ key: string; orders: ReportOrder[] } | null>(null);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const [weekly, setWeekly] = useState<{ enabled: boolean; email: string } | null>(null);
  // Cada cuánto se puede pedir un análisis nuevo y desde qué día el siguiente (lo dice el servidor)
  const [refresh, setRefresh] = useState<{ days: RefreshDays; nextDay: string | null } | null>(null);
  const [weeklyBusy, setWeeklyBusy] = useState(false);
  const periodKey = JSON.stringify(period);
  const source = periodOrders?.key === periodKey ? periodOrders.orders : orders;
  const metrics = useMemo(() => buildMetrics(source, branchLabel, period), [source, branchLabel, period]);
  const periodText = useMemo(() => advisorPeriodText(period, source), [period, source]);

  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PERIOD_STORE) || "null") as AdvisorPeriod | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- periodo guardado en este dispositivo
      if (p && ADVISOR_PERIODS.some(([k]) => k === p.key)) setPeriod(p);
    } catch {}
  }, []);

  // Trae de la nube los pedidos desde el inicio del periodo anterior (toda la historia: todos)
  useEffect(() => {
    if (!loadOrders) return;
    let alive = true;
    const p = JSON.parse(periodKey) as AdvisorPeriod;
    const r = p.key === "historia" ? null : advisorRanges(p, []);
    const since = r ? (r.previous ?? r.main).from : new Date(0);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- aviso de carga mientras llegan los pedidos
    setLoadingOrders(true);
    loadOrders(since)
      .then((list) => {
        if (alive && list) setPeriodOrders({ key: periodKey, orders: list });
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoadingOrders(false);
      });
    return () => {
      alive = false;
    };
  }, [periodKey, loadOrders]);

  function choosePeriod(p: AdvisorPeriod) {
    setPeriod(p);
    setPeriodOpen(false);
    try {
      localStorage.setItem(PERIOD_STORE, JSON.stringify(p));
    } catch {}
  }

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(STORE) || "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- análisis guardado en este dispositivo
      if (s?.analysis) setSaved(s);
    } catch {}
  }, []);

  // ¿Resumen por correo cada lunes?
  useEffect(() => {
    aiFetch("/api/ai/asesor", { method: "POST", body: JSON.stringify({ action: "estado" }) })
      .then((r) => r.json())
      .then((b) => {
        if (!b.success) return;
        setWeekly({ enabled: b.enabled, email: b.email });
        if (b.refresh) setRefresh({ days: asRefreshDays(b.refresh.days), nextDay: b.refresh.nextDay || null });
      })
      .catch(() => undefined);
  }, []);

  async function toggleWeekly(enabled: boolean) {
    setWeeklyBusy(true);
    setError("");
    try {
      const r = await aiFetch("/api/ai/asesor", { method: "POST", body: JSON.stringify({ action: "correo", enabled }) });
      const b = await r.json();
      if (!r.ok || !b.success) throw new Error(b.error || "No se pudo.");
      setWeekly({ enabled: b.enabled, email: b.email });
      // Los números de hoy, para que el primer lunes ya tenga con qué
      if (b.enabled) void syncAdvisorSnapshot(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo.");
    } finally {
      setWeeklyBusy(false);
    }
  }

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns, asking]);

  async function call(body: object) {
    const r = await aiFetch("/api/ai/asesor", { method: "POST", body: JSON.stringify({ ...body, metrics }) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok || !b.success) throw new Error(b.error || "El asesor no respondió. Intenta de nuevo.");
    return b;
  }

  async function analyze() {
    setBusy(true);
    setError("");
    try {
      const b = await call({ action: "analizar" });
      if (b.refresh) setRefresh({ days: asRefreshDays(b.refresh.days), nextDay: b.refresh.nextDay || null });
      const next = { date: today(), analysis: b.analysis as Analysis, period: periodText };
      setSaved(next);
      try {
        localStorage.setItem(STORE, JSON.stringify(next));
      } catch {}
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo.");
    } finally {
      setBusy(false);
    }
  }

  async function ask(text: string) {
    const q = text.trim();
    if (!q || asking) return;
    const next: Turn[] = [...turns, { role: "user", text: q }];
    setTurns(next);
    setQuestion("");
    setAsking(true);
    setError("");
    try {
      const b = await call({ action: "preguntar", turns: next });
      setTurns([...next, { role: "assistant", text: b.text }]);
    } catch (e) {
      setTurns(turns);
      setQuestion(q);
      setError(e instanceof Error ? e.message : "No se pudo.");
    } finally {
      setAsking(false);
    }
  }

  const a = saved?.analysis;
  // Sin respuesta del servidor todavía: como antes, uno por día en este dispositivo
  const locked = refresh ? Boolean(refresh.nextDay) : saved?.date === today();
  const every = REFRESH_OPTIONS.find((o) => o.value === (refresh?.days ?? 1))?.text || "una vez al día";

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-orange-500/40 bg-zinc-950 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-500 text-xl">✨</span>
            <div>
              <p className="font-black">Tu asesor de negocios</p>
              <p className="text-xs text-zinc-500">
                {branchLabel} · {metrics.fecha}
              </p>
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => setPeriodOpen((o) => !o)}
                aria-expanded={periodOpen}
                className={`rounded-full border px-3 py-1.5 text-xs font-black ${periodOpen ? "border-orange-500 text-orange-300" : "border-zinc-700 text-zinc-300 hover:border-orange-500"}`}
              >
                📅 {ADVISOR_PERIODS.find(([k]) => k === period.key)?.[1]} ▾
              </button>
              {periodOpen && (
                <div role="dialog" aria-label="En qué periodo se basa el asesor" className="absolute left-0 top-full z-40 mt-2 w-64 rounded-2xl border border-zinc-700 bg-zinc-950 p-2 shadow-2xl shadow-black">
                  <p className="px-2 pb-1 pt-1 text-[11px] font-bold text-zinc-500">¿En qué se basa el asesor?</p>
                  {ADVISOR_PERIODS.filter(([k]) => k !== "rango").map(([k, text]) => (
                    <button key={k} type="button" onClick={() => choosePeriod({ key: k })} className={`block w-full rounded-xl px-3 py-2 text-left text-sm font-bold ${period.key === k ? "bg-orange-500 text-black" : "text-zinc-200 hover:bg-zinc-900"}`}>
                      {text}
                    </button>
                  ))}
                  <div className={`mt-1 rounded-xl p-2 ${period.key === "rango" ? "bg-orange-500/10" : ""}`}>
                    <p className="text-sm font-bold text-zinc-200">Rango personalizado</p>
                    <div className="mt-1 grid grid-cols-2 gap-1">
                      <input type="date" value={custom.from || period.from || ""} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="rounded-lg border border-zinc-800 bg-black px-2 py-1 text-xs" aria-label="Desde" />
                      <input type="date" value={custom.to || period.to || ""} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="rounded-lg border border-zinc-800 bg-black px-2 py-1 text-xs" aria-label="Hasta" />
                    </div>
                    <button
                      type="button"
                      disabled={!(custom.from || period.from) || !(custom.to || period.to)}
                      onClick={() => choosePeriod({ key: "rango", from: custom.from || period.from, to: custom.to || period.to })}
                      className="mt-1 w-full rounded-lg bg-orange-500 py-1 text-xs font-black text-black disabled:opacity-40"
                    >
                      Usar este rango
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <button
            disabled={busy || locked}
            onClick={() => void analyze()}
            className="rounded-2xl border border-orange-500 px-4 py-2 text-sm font-black text-orange-400 disabled:border-zinc-800 disabled:text-zinc-600"
          >
            {busy ? "Analizando..." : a ? "↻ Actualizar análisis" : "✨ Analizar"}
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Puedes pedir un análisis nuevo {every}.
          {locked ? (refresh?.nextDay ? ` El siguiente, desde el ${dayLabel(refresh.nextDay)}.` : " Ya pediste el de hoy.") : ""}
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          📅 Se basa en: <b className="text-zinc-200">{periodText}</b>
          {loadingOrders ? " · cargando pedidos..." : ""}
          {a && saved?.period && saved.period !== periodText ? (locked ? " · el análisis de abajo es de otro periodo; el nuevo se usa en el próximo análisis y ya en las preguntas." : " · el análisis de abajo es de otro periodo: toca Actualizar.") : ""}
        </p>

        {!a && !busy && <p className="mt-4 rounded-2xl bg-black p-4 text-sm text-zinc-400">Elige el periodo en 📅, toca “Analizar” y tu asesor revisa tus ventas, platillos, horarios, gastos y clientes para decirte qué hacer.</p>}
        {busy && <p className="mt-4 animate-pulse rounded-2xl bg-black p-4 text-sm text-zinc-400">Revisando tus números...</p>}
        {a && (
          <>
            {saved?.period && <p className="mt-4 text-[11px] font-black uppercase tracking-wide text-orange-300">Análisis de: {saved.period}</p>}
            <p className={`${saved?.period ? "mt-1" : "mt-4"} text-sm leading-relaxed text-zinc-200`}>{a.resumen}</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-black text-red-300">⚠️ Alertas</p>
                <div className="space-y-2">
                  {a.alertas.map((x, i) => (
                    <div key={i} className="rounded-2xl border border-zinc-800 bg-black p-3">
                      <p className="text-sm font-black">{x.titulo}</p>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-400">{x.texto}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-black text-emerald-300">💡 Consejos</p>
                <div className="space-y-2">
                  {a.consejos.map((x, i) => (
                    <div key={i} className="rounded-2xl border border-zinc-800 bg-black p-3">
                      <p className="text-sm font-black">{x.titulo}</p>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-400">{x.texto}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
        <p className="font-black">💬 Pregúntale a tu asesor</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTED.map((s) => (
            <button key={s} disabled={asking} onClick={() => void ask(s)} className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs font-bold text-zinc-300 hover:border-orange-500 disabled:opacity-40">
              {s}
            </button>
          ))}
        </div>
        {turns.length > 0 && (
          <div className="mt-4 max-h-[420px] space-y-3 overflow-y-auto">
            {turns.map((t, i) => (
              <div key={i} className={t.role === "user" ? "flex justify-end" : ""}>
                <p className={`max-w-[90%] whitespace-pre-line rounded-2xl px-4 py-3 text-sm ${t.role === "user" ? "bg-orange-500 font-bold text-black" : "bg-black text-zinc-200"}`}>{t.text}</p>
              </div>
            ))}
            {asking && <p className="animate-pulse text-sm text-zinc-500">Tu asesor está escribiendo...</p>}
            <div ref={chatEnd} />
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void ask(question)}
            placeholder="Ej. ¿qué platillo me deja más?"
            className="min-w-0 flex-1 rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
          />
          <button disabled={asking || !question.trim()} onClick={() => void ask(question)} className="rounded-2xl bg-orange-500 px-4 font-black text-black disabled:opacity-40" aria-label="Enviar">
            ➤
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-600">Usa la IA incluida en tu plan. Responde con tus números; para temas fiscales, consulta a tu contador.</p>
      </section>

      {weekly && (
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
          <span>
            <span className="block font-black">📧 Recibir el resumen por correo cada lunes</span>
            <span className="block text-xs text-zinc-500">{weekly.enabled ? `Llega a ${weekly.email} los lunes en la mañana.` : "Tu asesor te manda el análisis de la semana a tu correo."}</span>
          </span>
          <input type="checkbox" disabled={weeklyBusy} checked={weekly.enabled} onChange={(e) => void toggleWeekly(e.target.checked)} className="h-6 w-6 shrink-0 accent-emerald-500" />
        </label>
      )}
      {error && <p className="rounded-2xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
    </div>
  );
}
