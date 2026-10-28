"use client";

import { useEffect, useMemo, useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import { getAuditLog, type AuditEvent } from "@/lib/audit";

export default function AuditPage() {
  const [log, setLog] = useState<AuditEvent[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todas");
  const [date, setDate] = useState("");

  useEffect(() => {
    const load = () => setLog(getAuditLog());
    load();
    window.addEventListener("bpos:audit-updated", load);
    return () => window.removeEventListener("bpos:audit-updated", load);
  }, []);

  const categories = useMemo(
    () => ["Todas", ...Array.from(new Set(log.map((item) => item.category))).sort()],
    [log]
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return log.filter((item) => {
      const matchesText = !term || `${item.category} ${item.action} ${item.description} ${item.userName || ""}`.toLowerCase().includes(term);
      const matchesCategory = category === "Todas" || item.category === category;
      const matchesDate = !date || item.createdAt.slice(0, 10) === date;
      return matchesText && matchesCategory && matchesDate;
    });
  }, [log, query, category, date]);

  return (
    <RequireRole allow={["Admin"]}>
      <AppShell title="Bitácora general" subtitle="Trazabilidad de caja, ventas y acciones sensibles.">
        <div className="mb-5 grid gap-3 md:grid-cols-[2fr_1fr_1fr]">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por usuario, acción o módulo" className="rounded-2xl border border-zinc-800 bg-black px-4 py-3" />
          <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-2xl border border-zinc-800 bg-black px-4 py-3">
            {categories.map((item) => <option key={item}>{item}</option>)}
          </select>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="rounded-2xl border border-zinc-800 bg-black px-4 py-3" />
        </div>
        <p className="mb-4 text-sm text-zinc-500">{filtered.length} evento(s)</p>
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
          {filtered.length === 0 && <div className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500">Sin eventos para los filtros seleccionados.</div>}
        </div>
      </AppShell>
    </RequireRole>
  );
}
