"use client";
/**
 * Administrador de B-POS → Servicios por separado: precio al mes, días de
 * prueba, presupuesto de IA (asesor) y si se vende cada servicio de
 * bpos.com.mx/servicios. Solo el dueño de la plataforma (/api/admin/servicios).
 */
import { useCallback, useEffect, useState } from "react";
import { aiFetch } from "@/lib/ai/client";
import { SERVICES, money, type CatalogEntry, type ServiceId } from "@/lib/services";

type Row = CatalogEntry & { trials: number; paying: number };
type Draft = { price: string; trialDays: string; aiBudgetUsd: string; active: boolean };

const input = "w-full rounded-xl border border-zinc-800 bg-black px-3 py-2 text-sm text-white";

export function ServicesCatalogCard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const apply = useCallback((list: Row[]) => {
    setRows(list);
    setDrafts(Object.fromEntries(list.map((r) => [r.service, { price: String(r.price), trialDays: String(r.trial_days), aiBudgetUsd: String(r.ai_budget_usd), active: r.active }])));
  }, []);

  useEffect(() => {
    aiFetch("/api/admin/servicios")
      .then((r) => r.json())
      .then((b) => (b.catalog ? apply(b.catalog as Row[]) : setMsg({ ok: false, text: b.error || "No se pudo leer." })))
      .catch(() => setMsg({ ok: false, text: "No se pudo leer el catálogo de servicios." }));
  }, [apply]);

  async function save(service: ServiceId) {
    const d = drafts[service];
    setBusy(service);
    setMsg(null);
    try {
      const r = await aiFetch("/api/admin/servicios", { method: "POST", body: JSON.stringify({ service, price: Number(d.price), trialDays: Number(d.trialDays), aiBudgetUsd: Number(d.aiBudgetUsd), active: d.active }) });
      const b = await r.json();
      if (!r.ok || !b.catalog) throw new Error(b.error || "No se pudo guardar.");
      apply(b.catalog as Row[]);
      setMsg({ ok: true, text: "✅ Guardado. Los precios nuevos aplican a las contrataciones de ahora en adelante." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "No se pudo guardar." });
    }
    setBusy("");
  }

  const set = (service: string, patch: Partial<Draft>) => setDrafts((all) => ({ ...all, [service]: { ...all[service], ...patch } }));

  return (
    <section className="rounded-3xl border border-orange-500/40 bg-zinc-950 p-5">
      <h2 className="text-xl font-black">🧩 Servicios por separado</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Lo que se vende suelto en <b>bpos.com.mx/servicios</b>: precio al mes, días de prueba gratis y si está a la venta. El asesor con IA usa su propio presupuesto de IA al mes (en dólares).
      </p>
      {!rows && !msg && <p className="mt-3 text-sm text-zinc-500">Cargando...</p>}
      {rows && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {SERVICES.map((s) => {
            const r = rows.find((x) => x.service === s.id);
            const d = drafts[s.id];
            if (!r || !d) return null;
            return (
              <div key={s.id} className="rounded-2xl border border-zinc-800 bg-black/40 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-black">
                    {s.emoji} {s.name}
                    {s.addonOf ? <span className="ml-2 text-xs font-bold text-zinc-500">extra del menú</span> : null}
                  </p>
                  <label className="flex items-center gap-2 text-xs font-bold text-zinc-400">
                    <input type="checkbox" checked={d.active} onChange={(e) => set(s.id, { active: e.target.checked })} className="h-4 w-4 accent-orange-500" />A la venta
                  </label>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {r.paying} pagando · {r.trials} en prueba · ahora {money(r.price)}/mes
                </p>
                <div className={`mt-3 grid gap-2 ${s.id === "asesor" ? "grid-cols-3" : "grid-cols-2"}`}>
                  <label className="text-xs font-bold text-zinc-400">
                    Precio al mes (MXN)
                    <input type="number" min={0} value={d.price} onChange={(e) => set(s.id, { price: e.target.value })} className={`${input} mt-1`} />
                  </label>
                  <label className="text-xs font-bold text-zinc-400">
                    Días de prueba
                    <input type="number" min={0} max={90} value={d.trialDays} onChange={(e) => set(s.id, { trialDays: e.target.value })} className={`${input} mt-1`} />
                  </label>
                  {s.id === "asesor" && (
                    <label className="text-xs font-bold text-zinc-400">
                      IA al mes (USD)
                      <input type="number" min={0} step={0.5} value={d.aiBudgetUsd} onChange={(e) => set(s.id, { aiBudgetUsd: e.target.value })} className={`${input} mt-1`} />
                    </label>
                  )}
                </div>
                <button disabled={busy === s.id} onClick={() => void save(s.id)} className="mt-3 rounded-xl bg-orange-500 px-4 py-2 text-sm font-black text-black disabled:opacity-50">
                  {busy === s.id ? "Guardando..." : "Guardar"}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>{msg.text}</p>}
    </section>
  );
}
