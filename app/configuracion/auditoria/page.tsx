"use client";

import { useEffect, useMemo, useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import { getAuditLog, type AuditEvent } from "@/lib/audit";
import { flushCloudAudit, loadCloudAudit, pendingCloudAudit } from "@/lib/cloud/audit-outbox";

type Source = "nube" | "local";

export default function AuditPage() {
  const [log, setLog] = useState<AuditEvent[]>([]);
  const [cloud, setCloud] = useState<AuditEvent[] | null>(null);
  const [cloudError, setCloudError] = useState("");
  const [pending, setPending] = useState(0);
  const [source, setSource] = useState<Source>("nube");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todas");
  const [date, setDate] = useState("");

  useEffect(() => {
    const load = () => {
      setLog(getAuditLog());
      setPending(pendingCloudAudit());
    };
    const first = window.setTimeout(load, 0);
    window.addEventListener("bpos:audit-updated", load);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("bpos:audit-updated", load);
    };
  }, []);

  // Bitácora de la nube: la que nadie puede editar ni borrar
  useEffect(() => {
    if (source !== "nube") return;
    let alive = true;
    void flushCloudAudit()
      .then(() => loadCloudAudit(300))
      .then((rows) => {
        if (!alive) return;
        setPending(pendingCloudAudit());
        setCloudError(rows ? "" : "Inicia sesión con la cuenta del negocio para ver la bitácora en la nube.");
        setCloud(
          (rows || []).map((r) => ({
            id: r.event_id,
            category: r.category,
            action: r.action,
            description: r.description,
            createdAt: r.happened_at,
            userName: r.user_name || undefined,
          }))
        );
      })
      .catch((e) => {
        if (!alive) return;
        setCloud([]);
        setCloudError(
          /audit_events/.test(String(e?.message))
            ? "Falta aplicar 0004_bpos_bitacora.sql en Supabase (SQL Editor → pegar → Run)."
            : "No se pudo leer la bitácora de la nube. Revisa tu internet."
        );
      });
    return () => {
      alive = false;
    };
  }, [source]);

  const items = useMemo(() => (source === "nube" ? cloud || [] : log), [source, cloud, log]);

  const categories = useMemo(
    () => ["Todas", ...Array.from(new Set(items.map((item) => item.category))).sort()],
    [items]
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items.filter((item) => {
      const matchesText = !term || `${item.category} ${item.action} ${item.description} ${item.userName || ""}`.toLowerCase().includes(term);
      const matchesCategory = category === "Todas" || item.category === category;
      const matchesDate = !date || item.createdAt.slice(0, 10) === date;
      return matchesText && matchesCategory && matchesDate;
    });
  }, [items, query, category, date]);

  return (
    <RequireRole allow={["Admin"]}>
      <AppShell title="Bitácora general" subtitle="Trazabilidad de caja, ventas y acciones sensibles.">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {(
            [
              ["nube", "☁️ Nube (no se puede borrar)"],
              ["local", "Este dispositivo"],
            ] as [Source, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setSource(value)}
              className={`rounded-full px-4 py-2 text-sm font-black ${source === value ? "bg-orange-500 text-black" : "border border-zinc-800 text-zinc-300"}`}
            >
              {label}
            </button>
          ))}
          {pending > 0 && <span className="text-xs text-zinc-500">{pending} evento(s) de este dispositivo por subir a la nube</span>}
        </div>
        {source === "nube" && cloudError && (
          <p className="mb-4 rounded-2xl border border-orange-500/40 bg-orange-500/10 p-3 text-sm text-orange-200">{cloudError}</p>
        )}
        <div className="mb-5 grid gap-3 md:grid-cols-[2fr_1fr_1fr]">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por usuario, acción o módulo" className="rounded-2xl border border-zinc-800 bg-black px-4 py-3" />
          <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-2xl border border-zinc-800 bg-black px-4 py-3">
            {categories.map((item) => <option key={item}>{item}</option>)}
          </select>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="rounded-2xl border border-zinc-800 bg-black px-4 py-3" />
        </div>
        <p className="mb-4 text-sm text-zinc-500">
          {source === "nube" && cloud === null ? "Cargando..." : `${filtered.length} evento(s)`}
        </p>
        <div className="space-y-3">
          {filtered.map((item) => (
            <div key={item.id} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
              <div className="flex flex-wrap justify-between gap-2">
                <p className="font-black text-orange-400">{item.category} · {item.action}</p>
                <p className="text-xs text-zinc-500">{new Date(item.createdAt).toLocaleString()}</p>
              </div>
              <p className="mt-2 text-sm text-zinc-200">{item.description}</p>
              {item.userName && <p className="mt-1 text-xs text-zinc-500">Usuario: {item.userName}</p>}
              {item.entityId && <p className="mt-1 text-xs text-zinc-600">Referencia: {item.entityId}</p>}
            </div>
          ))}
          {filtered.length === 0 && !(source === "nube" && cloud === null) && (
            <div className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500">Sin eventos para los filtros seleccionados.</div>
          )}
        </div>
      </AppShell>
    </RequireRole>
  );
}
