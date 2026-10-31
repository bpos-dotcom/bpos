"use client";
/**
 * App del dueño → ✨ Asesor con IA: con los números del negocio (ventas,
 * platillos, horas, gastos, clientes) arma el resumen de la semana, alertas
 * y consejos, y responde preguntas. Un análisis nuevo por día; el chat,
 * cuando quiera. Solo plan Max (app/api/ai/asesor).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { aiFetch } from "@/lib/ai/client";
import { getBusinessSettings } from "@/lib/business-settings";
import { getCoupons, couponState } from "@/lib/coupons";
import { buildCustomers } from "@/lib/customers";
import { breakEven, getExpenses, getFixedExpenses } from "@/lib/finance";
import { buildReport, loadReportSources, presetRange, type ReportOrder, type Row } from "@/lib/reports";
import { DAY_NAMES } from "@/lib/sale-schedule";

type Analysis = { resumen: string; alertas: { titulo: string; texto: string }[]; consejos: { titulo: string; texto: string }[] };
type Turn = { role: "user" | "assistant"; text: string };

const STORE = "asesor:analisis";
const SUGGESTED = ["¿Qué hago en mis días flojos?", "¿Qué platillo me deja más?", "¿Debería subir algún precio?", "¿Dónde puedo ahorrar?"];
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

function kpis(k: ReturnType<typeof buildReport>["kpis"]) {
  return { ventas: r2(k.sales), pedidos: k.orders, ticketPromedio: r2(k.averageTicket), descuentos: r2(k.discounts), costo: r2(k.cost), utilidadBruta: r2(k.profit), margenPct: r2(k.margin) };
}

/** Los números que ve el asesor (compactos) */
function buildMetrics(orders: ReportOrder[], branchLabel: string) {
  const src = { ...loadReportSources(), orders };
  const now = new Date();
  const day = 24 * 60 * 60 * 1000;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const week = buildReport(src, { from: new Date(start.getTime() - 7 * day), to: start });
  const prev = buildReport(src, { from: new Date(start.getTime() - 14 * day), to: new Date(start.getTime() - 7 * day) });
  const month = buildReport(src, presetRange("mes"));
  const last28 = buildReport(src, { from: new Date(start.getTime() - 28 * day), to: start });

  const byWeekday = DAY_NAMES.map((name) => ({ dia: name, ventas: 0, pedidos: 0 }));
  last28.byDay.forEach((r) => {
    const [y, m, d] = r.label.split("-").map(Number);
    const w = byWeekday[new Date(y, m - 1, d).getDay()];
    w.ventas = r2(w.ventas + r.sales);
    w.pedidos += r.count;
  });
  const fixed = getFixedExpenses().reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const loose = getExpenses().filter((e) => e.date >= monthStart).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const monthMargin = month.kpis.sales > 0 ? (month.kpis.profit / month.kpis.sales) * 100 : 0;
  const customers = buildCustomers(orders as Parameters<typeof buildCustomers>[0]);
  const product = (r: Row) => ({ nombre: r.label, piezas: r.quantity, ventas: r2(r.sales), costo: r2(r.cost), margenPct: r.cost ? r2(r.margin) : null });

  return {
    negocio: getBusinessSettings().businessName,
    sucursal: branchLabel,
    fecha: now.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    ultimos7Dias: kpis(week.kpis),
    los7DiasAnteriores: kpis(prev.kpis),
    mesEnCurso: {
      ...kpis(month.kpis),
      diasTranscurridos: now.getDate(),
      diasDelMes: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
      foodCostPct: month.kpis.sales ? r2((month.kpis.cost / month.kpis.sales) * 100) : null,
      gastosFijosDelMes: r2(fixed),
      gastosSueltosDelMes: r2(loose),
      utilidadReal: r2(month.kpis.profit - fixed - loose),
      puntoDeEquilibrioMensual: breakEven(fixed + loose, monthMargin) ? r2(breakEven(fixed + loose, monthMargin)!) : null,
      ventasConCostoPct: r2(month.kpis.costCoverage),
    },
    ultimas4Semanas: {
      porDiaDeLaSemana: byWeekday,
      porHora: last28.byHour.filter((r) => r.count > 0).map((r) => ({ hora: `${r.label}:00`, ventas: r2(r.sales), pedidos: r.count })),
      platillos: last28.byProduct.slice(0, 20).map(product),
      categorias: last28.byCategory.slice(0, 10).map((r) => ({ nombre: r.label, ventas: r2(r.sales), margenPct: r.cost ? r2(r.margin) : null })),
      canales: last28.byChannel.map((r) => ({ canal: r.label, ventas: r2(r.sales), pedidos: r.count })),
      pagos: last28.byPayment.map((r) => ({ forma: r.label, ventas: r2(r.sales) })),
    },
    clientes: {
      conNombreOTelefono: customers.length,
      nuevosUltimos30Dias: customers.filter((c) => c.segment === "nuevo").length,
      frecuentes: customers.filter((c) => c.segment === "frecuente" || c.segment === "vip").length,
      dormidos45Dias: customers.filter((c) => c.segment === "dormido").length,
    },
    cuponesActivos: getCoupons().filter((c) => couponState(c) === "activo").map((c) => ({ codigo: c.code, usos: c.uses })),
  };
}

export function Advisor({ orders, branchLabel }: { orders: ReportOrder[]; branchLabel: string }) {
  const [saved, setSaved] = useState<{ date: string; analysis: Analysis } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const metrics = useMemo(() => buildMetrics(orders, branchLabel), [orders, branchLabel]);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(STORE) || "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- análisis guardado en este dispositivo
      if (s?.analysis) setSaved(s);
    } catch {}
  }, []);

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
      const next = { date: today(), analysis: b.analysis as Analysis };
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
  const usedToday = saved?.date === today();

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
          </div>
          <button
            disabled={busy || usedToday}
            onClick={() => void analyze()}
            className="rounded-2xl border border-orange-500 px-4 py-2 text-sm font-black text-orange-400 disabled:border-zinc-800 disabled:text-zinc-600"
          >
            {busy ? "Analizando..." : a ? "↻ Actualizar análisis" : "✨ Analizar mi semana"}
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">Puedes pedir un análisis nuevo una vez al día.{usedToday ? " Ya pediste el de hoy." : ""}</p>

        {!a && !busy && <p className="mt-4 rounded-2xl bg-black p-4 text-sm text-zinc-400">Toca “Analizar mi semana” y tu asesor revisa tus ventas, platillos, horarios, gastos y clientes para decirte qué hacer.</p>}
        {busy && <p className="mt-4 animate-pulse rounded-2xl bg-black p-4 text-sm text-zinc-400">Revisando tus números...</p>}
        {a && (
          <>
            <p className="mt-4 text-sm leading-relaxed text-zinc-200">{a.resumen}</p>
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
                <p className="mb-2 text-sm font-black text-emerald-300">💡 Consejos para esta semana</p>
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
      {error && <p className="rounded-2xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
    </div>
  );
}
