"use client";
/**
 * App del dueño → ✨ Asesor con IA: con los números del negocio (ventas,
 * platillos, horas, gastos, clientes) arma el resumen de la semana, alertas
 * y consejos, y responde preguntas. Un análisis nuevo por día; el chat,
 * cuando quiera. Solo plan Max (app/api/ai/asesor).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { aiFetch } from "@/lib/ai/client";
import { buildMetrics, today } from "@/lib/advisor-metrics";
import { syncAdvisorSnapshot } from "@/lib/advisor-sync";
import type { ReportOrder } from "@/lib/reports";

type Analysis = { resumen: string; alertas: { titulo: string; texto: string }[]; consejos: { titulo: string; texto: string }[] };
type Turn = { role: "user" | "assistant"; text: string };

const STORE = "asesor:analisis";
const SUGGESTED = ["¿Qué hago en mis días flojos?", "¿Qué platillo me deja más?", "¿Debería subir algún precio?", "¿Dónde puedo ahorrar?"];
export function Advisor({ orders, branchLabel }: { orders: ReportOrder[]; branchLabel: string }) {
  const [saved, setSaved] = useState<{ date: string; analysis: Analysis } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const [weekly, setWeekly] = useState<{ enabled: boolean; email: string } | null>(null);
  const [weeklyBusy, setWeeklyBusy] = useState(false);
  const metrics = useMemo(() => buildMetrics(orders, branchLabel), [orders, branchLabel]);

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
      .then((b) => b.success && setWeekly({ enabled: b.enabled, email: b.email }))
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
