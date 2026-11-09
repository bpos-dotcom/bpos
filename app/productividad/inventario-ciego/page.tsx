"use client";
/**
 * Inventario ciego, en su propia ventana (el POS sigue libre). Viene la lista
 * de insumos SIN lo que dice el sistema: el personal pone lo que contó. Al
 * capturar cada uno se guarda en secreto lo que decía B-POS en ese momento
 * (así las ventas que entren mientras cuentan no lo descuadran). Al subirlo
 * le llega al dueño a su app y a su correo; el inventario no cambia hasta
 * que el dueño lo decida.
 */
import { useEffect, useMemo, useState } from "react";
import { ask, notify } from "@/components/layout/Dialogs";
import { emailBlindReport } from "@/lib/productivity-remote";
import { PRODUCTIVITY_EVENT, getBlindCounts, setBlindLine, submitBlind, type BlindCount } from "@/lib/productivity";

export default function BlindCountPage() {
  const [id, setId] = useState("");
  const [count, setCount] = useState<BlindCount | null>(null);
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState("");

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("id") || "";
    const sync = () => {
      setId(wanted);
      setCount(getBlindCounts().find((c) => c.id === wanted) || null);
    };
    sync();
    window.addEventListener(PRODUCTIVITY_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PRODUCTIVITY_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, BlindCount["lines"]>();
    for (const line of count?.lines || []) {
      if (q && !line.name.toLowerCase().includes(q)) continue;
      const key = line.category || "Sin categoría";
      map.set(key, [...(map.get(key) || []), line]);
    }
    return [...map.entries()];
  }, [count, search]);

  const total = count?.lines.length || 0;
  const counted = count?.lines.filter((l) => l.counted !== null).length || 0;

  function save(ingredientId: number, raw: string) {
    const text = raw.replace(",", ".").trim();
    if (text === "") return setBlindLine(id, ingredientId, null);
    const value = Number(text);
    if (!Number.isFinite(value) || value < 0) {
      notify("Escribe una cantidad válida.", "error");
      return;
    }
    setBlindLine(id, ingredientId, Math.round(value * 1000) / 1000);
  }

  async function submit() {
    if (!count) return;
    const missing = total - counted;
    const ok = await ask(missing ? `Faltan ${missing} insumo(s) sin contar. ¿Subir así? (le llega al dueño)` : "¿Subir el inventario ciego? Le llega al dueño a su app y a su correo.", { ok: "Sí, subir", cancel: "Seguir contando" });
    if (!ok) return;
    setBusy(true);
    try {
      const saved = submitBlind(count.id);
      let mail = "";
      try {
        mail = await emailBlindReport(saved);
      } catch (e) {
        notify(`Se subió, pero el correo no salió: ${e instanceof Error ? e.message : "error"}`, "error");
      }
      setFinished(mail ? `Le llegó al dueño a su app y a ${mail}.` : "Le llegó al dueño a su app.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "No se pudo subir.", "error");
    } finally {
      setBusy(false);
    }
  }

  if (finished) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-black p-6 text-center text-white">
        <p className="text-5xl">✅</p>
        <h1 className="mt-4 text-3xl font-black">¡Inventario ciego enviado!</h1>
        <p className="mt-2 text-zinc-300">{finished}</p>
        <button onClick={() => window.close()} className="mt-6 rounded-2xl bg-orange-500 px-8 py-3 font-black text-black">
          Cerrar esta ventana
        </button>
      </main>
    );
  }

  if (!count || count.status !== "en curso") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-black p-6 text-center text-white">
        <h1 className="text-2xl font-black">{count ? "Este inventario ciego ya se subió." : "Cargando el inventario ciego…"}</h1>
        <p className="mt-2 text-sm text-zinc-400">Si no aparece, ciérrala y vuelve a darle Empezar en Productividad.</p>
        <button onClick={() => window.close()} className="mt-6 rounded-2xl border border-zinc-700 px-6 py-3 font-black text-zinc-300">
          Cerrar
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black pb-32 text-white">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-black/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-2xl font-black text-orange-400">📦 Inventario ciego</p>
            <p className="text-xs text-zinc-400">
              {counted} de {total} contados · empezó {count.startedBy}
            </p>
          </div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar insumo…" className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2 sm:w-64" />
        </div>
        <div className="mx-auto mt-2 h-2 max-w-3xl overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full bg-orange-500 transition-all" style={{ width: `${total ? (counted / total) * 100 : 0}%` }} />
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-6 px-4 pt-4">
        <p className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-400">Cuenta lo que hay físicamente y escribe la cantidad en la unidad que se indica. Se guarda solo; si te interrumpen, puedes seguir después.</p>
        {groups.map(([category, lines]) => (
          <section key={category}>
            <h2 className="mb-2 text-sm font-black uppercase tracking-wide text-zinc-500">{category}</h2>
            <div className="space-y-2">
              {lines.map((line) => {
                const draft = drafts[line.ingredientId];
                const value = draft !== undefined ? draft : line.counted === null ? "" : String(line.counted);
                return (
                  <div key={line.ingredientId} className={`flex items-center justify-between gap-3 rounded-2xl border p-3 ${line.counted !== null ? "border-emerald-500/40 bg-emerald-500/5" : "border-zinc-800 bg-zinc-950"}`}>
                    <p className="min-w-0 flex-1 text-lg font-black">
                      {line.counted !== null && <span className="mr-1 text-emerald-400">✓</span>}
                      {line.name}
                    </p>
                    <div className="flex shrink-0 items-center gap-2">
                      <input
                        inputMode="decimal"
                        value={value}
                        onChange={(e) => setDrafts((d) => ({ ...d, [line.ingredientId]: e.target.value }))}
                        onBlur={(e) => {
                          save(line.ingredientId, e.target.value);
                          setDrafts((d) => {
                            const next = { ...d };
                            delete next[line.ingredientId];
                            return next;
                          });
                        }}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                        placeholder="0"
                        className="w-28 rounded-xl border border-zinc-700 bg-black px-3 py-3 text-right text-xl font-black"
                      />
                      <span className="w-10 text-sm font-bold text-zinc-400">{line.unit}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-zinc-800 bg-black/95 p-4 backdrop-blur">
        <button onClick={() => void submit()} disabled={busy} className="mx-auto block w-full max-w-3xl rounded-2xl bg-orange-500 px-6 py-4 text-xl font-black text-black disabled:opacity-50">
          {busy ? "Subiendo…" : `⬆️ Subir inventario (${counted}/${total})`}
        </button>
      </div>
    </main>
  );
}
