"use client";
/**
 * B-POS Servicios → Asesor con IA: el dueño sube sus reportes en Excel o CSV
 * (DiDi, Uber, Rappi, su punto de venta...). Cada hoja se resume aquí mismo
 * (lib/report-summary.ts: encabezados, totales, lo más vendido, muestra) y el
 * asesor (app/api/ai/asesor, fuente "reportes") arma el resumen, las alertas
 * y los consejos; después se le puede preguntar en el chat. El análisis nuevo
 * tiene el mismo límite que el del asesor (diario, cada 3 días o semanal).
 */
import { useEffect, useRef, useState } from "react";
import RequirePermission from "@/components/auth/RequirePermission";
import { AppShell } from "@/components/layout/AppShell";
import { aiFetch } from "@/lib/ai/client";
import { readSpreadsheetSheets } from "@/lib/xlsx";
import { summarizeSheet, type SheetSummary } from "@/lib/report-summary";
import { asRefreshDays, dayLabel, REFRESH_OPTIONS, type RefreshDays } from "@/lib/ai/advisor-refresh";

type Analysis = { resumen: string; alertas: { titulo: string; texto: string }[]; consejos: { titulo: string; texto: string }[] };
type Turn = { role: "user" | "assistant"; text: string };
type Report = { file: string; sheets: SheetSummary[] };

const STORE = "asesor:reportes";
const MAX_CHARS = 38_000;
const SUGGESTED = ["¿Qué producto me deja más?", "¿Cuánto me cobran las apps de comisión?", "¿Qué día vendo menos y qué hago?", "¿Debería subir precios en las apps?"];

/** Recorta el resumen hasta que quepa (menos muestra, menos valores) */
function fit(reports: Report[]) {
  const sheets = reports.flatMap((r) => r.sheets).slice(0, 12);
  for (const [sample, top] of [[8, 10], [4, 6], [2, 4], [0, 3]] as const) {
    const data = { reportes: sheets.map((s) => ({ ...s, muestra: s.muestra.slice(0, sample), columnas: s.columnas.map((c) => ({ ...c, masComunes: c.masComunes?.slice(0, top), porMonto: c.porMonto?.slice(0, top) })) })) };
    if (JSON.stringify(data).length <= MAX_CHARS) return data;
  }
  return { reportes: sheets.map((s) => ({ ...s, muestra: [], columnas: s.columnas.slice(0, 12) })) };
}

export default function ReportsAdvisorPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{ at: string; files: string[]; analysis: Analysis } | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [refresh, setRefresh] = useState<{ days: RefreshDays; nextDay: string | null } | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(STORE) || "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- último análisis guardado en este dispositivo
      if (s?.analysis) setSaved(s);
    } catch {}
    aiFetch("/api/ai/asesor", { method: "POST", body: JSON.stringify({ action: "estado" }) })
      .then((r) => r.json())
      .then((b) => b.success && b.refresh && setRefresh({ days: asRefreshDays(b.refresh.days), nextDay: b.refresh.nextDay || null }))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns, asking]);

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setReading(true);
    setError("");
    const added: Report[] = [];
    for (const file of [...list].slice(0, 8)) {
      try {
        const sheets = (await readSpreadsheetSheets(file)).map((s) => summarizeSheet(file.name, s.name, s.rows)).filter((s) => s.renglones > 0);
        if (!sheets.length) throw new Error("no trae datos");
        added.push({ file: file.name, sheets });
      } catch (e) {
        setError(`${file.name}: ${e instanceof Error ? e.message : "no se pudo leer"}.`);
      }
    }
    setReports((r) => [...r.filter((x) => !added.some((a) => a.file === x.file)), ...added]);
    setReading(false);
  }

  async function call(body: object) {
    const r = await aiFetch("/api/ai/asesor", { method: "POST", body: JSON.stringify({ ...body, fuente: "reportes", metrics: fit(reports) }) });
    const b = await r.json().catch(() => ({}));
    if (b.refresh) setRefresh({ days: asRefreshDays(b.refresh.days), nextDay: b.refresh.nextDay || null });
    if (!r.ok || !b.success) throw new Error(b.error || "El asesor no respondió. Intenta de nuevo.");
    return b;
  }

  async function analyze() {
    setBusy(true);
    setError("");
    try {
      const b = await call({ action: "analizar" });
      const next = { at: new Date().toISOString(), files: reports.map((r) => r.file), analysis: b.analysis as Analysis };
      setSaved(next);
      setTurns([]);
      try {
        localStorage.setItem(STORE, JSON.stringify(next));
      } catch {}
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo.");
    }
    setBusy(false);
  }

  async function ask(text: string) {
    const q = text.trim();
    if (!q || asking) return;
    if (!reports.length) return setError("Sube tus reportes para que el asesor pueda contestar con tus números.");
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
    }
    setAsking(false);
  }

  const locked = Boolean(refresh?.nextDay);
  const every = REFRESH_OPTIONS.find((o) => o.value === (refresh?.days ?? 1))?.text || "una vez al día";
  const a = saved?.analysis;
  const rowsTotal = reports.reduce((s, r) => s + r.sheets.reduce((t, x) => t + x.renglones, 0), 0);

  return (
    <RequirePermission permission="reports.view">
      <AppShell title="Asesor con IA" subtitle="Sube tus reportes de DiDi, Uber, Rappi o tu punto de venta y recibe consejos para vender más.">
        <div className="max-w-5xl space-y-5">
          <section className="rounded-3xl border border-orange-500/40 bg-zinc-950 p-5">
            <p className="text-lg font-black">📊 1. Sube tus reportes</p>
            <p className="mt-1 text-sm text-zinc-400">Excel (.xlsx) o CSV: ventas por día, por producto, pedidos o liquidaciones de las apps. Puedes subir varios a la vez. Tus archivos no se guardan: solo se manda un resumen de cada hoja.</p>
            <label className="mt-4 inline-block cursor-pointer rounded-2xl bg-orange-500 px-5 py-3 font-black text-black">
              {reading ? "Leyendo..." : reports.length ? "+ Agregar más" : "Elegir archivos"}
              <input type="file" multiple accept=".xlsx,.csv,text/csv" className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
            </label>
            {reports.length > 0 && (
              <ul className="mt-4 space-y-2">
                {reports.map((r) => (
                  <li key={r.file} className="flex items-start justify-between gap-3 rounded-2xl border border-zinc-800 bg-black/40 p-3 text-sm">
                    <span>
                      <b>{r.file}</b>
                      <span className="block text-xs text-zinc-500">{r.sheets.map((s) => `${s.hoja}: ${s.renglones} renglón${s.renglones === 1 ? "" : "es"}, ${s.columnas.length} columna${s.columnas.length === 1 ? "" : "s"}`).join(" · ")}</span>
                    </span>
                    <button onClick={() => setReports((list) => list.filter((x) => x.file !== r.file))} className="text-xs font-black text-zinc-500 hover:text-red-400">
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-lg font-black">✨ 2. Tu análisis</p>
              <button disabled={busy || locked || !reports.length} onClick={() => void analyze()} className="rounded-2xl bg-orange-500 px-5 py-2.5 text-sm font-black text-black disabled:opacity-40">
                {busy ? "Analizando..." : `Analizar ${reports.length ? `${rowsTotal.toLocaleString("es-MX")} renglones` : "mis reportes"}`}
              </button>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Puedes pedir un análisis nuevo {every}.{locked && refresh?.nextDay ? ` El siguiente, desde el ${dayLabel(refresh.nextDay)}.` : ""} El chat de abajo no tiene ese límite.
            </p>
            {busy && <p className="mt-4 animate-pulse rounded-2xl bg-black p-4 text-sm text-zinc-400">Revisando tus reportes...</p>}
            {!a && !busy && <p className="mt-4 rounded-2xl bg-black p-4 text-sm text-zinc-400">Sube tus reportes y toca Analizar: tu asesor identifica qué es cada uno y te dice qué está pasando y qué hacer.</p>}
            {a && !busy && (
              <>
                <p className="mt-3 text-xs text-zinc-500">
                  {new Date(saved!.at).toLocaleString("es-MX")} · {saved!.files.join(", ")}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-zinc-200">{a.resumen}</p>
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
                placeholder="Ej. ¿qué día vendo menos?"
                className="min-w-0 flex-1 rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
              />
              <button disabled={asking || !question.trim()} onClick={() => void ask(question)} className="rounded-2xl bg-orange-500 px-4 font-black text-black disabled:opacity-40" aria-label="Enviar">
                ➤
              </button>
            </div>
            <p className="mt-2 text-xs text-zinc-600">Responde con los números de tus reportes. Para temas fiscales, consulta a tu contador.</p>
          </section>
          {error && <p className="rounded-2xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        </div>
      </AppShell>
    </RequirePermission>
  );
}
