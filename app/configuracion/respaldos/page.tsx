"use client";

import { useCallback, useEffect, useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import { getCurrentUser } from "@/lib/auth";
import { addAuditEvent } from "@/lib/audit";
import { createBackup, downloadBackup, downloadSavedBackup, listSavedBackups, readBackupFile, restoreBackup, saveDailyBackup } from "@/lib/cloud/backup";
import { authorizeWithAdminPin } from "@/lib/permissions";

type Saved = { day: string; size: number };

/** Configuración → Respaldos: copias diarias en la nube, descargar y restaurar. */
export default function RespaldosPage() {
  const [saved, setSaved] = useState<Saved[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setSaved(await listSavedBackups());
    } catch {
      setSaved([]);
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [load]);

  async function downloadNow() {
    setBusy("Preparando respaldo...");
    setError("");
    try {
      const backup = await createBackup();
      downloadBackup(backup);
      // También queda guardado en la nube como respaldo del día
      await saveDailyBackup(backup).catch(() => {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el respaldo.");
    } finally {
      setBusy("");
    }
  }

  async function restore(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      const backup = await readBackupFile(file);
      const date = new Date(backup.createdAt).toLocaleString("es-MX");
      if (
        !confirm(
          `¿Restaurar el respaldo del ${date} (${backup.records.length} registros)?\n\nSe vuelven a escribir sus ventas, productos, inventario y configuración en todos los dispositivos. Lo que se haya creado después de esa fecha se conserva.`
        )
      )
        return;
      if (!(await authorizeWithAdminPin("restaurar un respaldo", getCurrentUser()))) return;
      setBusy("Restaurando...");
      await restoreBackup(backup, (done, total) => setBusy(`Restaurando ${done} de ${total}...`));
      const user = getCurrentUser();
      addAuditEvent({ category: "Seguridad", action: "backup.restored", description: `${user.name} restauró el respaldo del ${date}`, userId: String(user.id), userName: user.name });
      alert("Respaldo restaurado. Los dispositivos se actualizan solos en unos segundos.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo restaurar.");
    } finally {
      setBusy("");
    }
  }

  return (
    <RequireRole allow={["Admin"]}>
      <AppShell title="Sistema · Respaldos" subtitle="Copia completa del negocio: ventas, productos, inventario, cortes y configuración.">
        <section className="mx-auto max-w-3xl space-y-6">
          <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <h2 className="text-xl font-black text-orange-500">Respaldo automático</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Todo vive en la nube y además, una vez al día, B-POS guarda una copia completa del negocio. Se conservan los últimos 7
              días.
            </p>
            <ul className="mt-4 space-y-2">
              {saved.length === 0 && <li className="text-sm text-zinc-500">Todavía no hay respaldos guardados.</li>}
              {saved.map((b) => (
                <li key={b.day} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-black px-4 py-3 text-sm">
                  <span className="font-bold">{b.day}</span>
                  <span className="text-zinc-500">{(b.size / 1024).toFixed(0)} KB</span>
                  <button
                    onClick={() => void downloadSavedBackup(b.day).catch((e) => setError(e instanceof Error ? e.message : "No se pudo descargar."))}
                    className="font-black text-orange-400"
                  >
                    Descargar
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <h2 className="text-xl font-black text-orange-500">Respaldo manual</h2>
            <div className="mt-4 flex flex-wrap gap-3">
              <button onClick={() => void downloadNow()} disabled={Boolean(busy)} className="rounded-2xl bg-orange-500 px-5 py-3 font-black text-black disabled:opacity-50">
                Descargar respaldo ahora
              </button>
              <label className="cursor-pointer rounded-2xl border border-zinc-700 px-5 py-3 font-black">
                Restaurar desde archivo
                <input type="file" accept="application/json,.json" className="hidden" disabled={Boolean(busy)} onChange={(e) => void restore(e.target.files?.[0])} />
              </label>
            </div>
            {busy && <p className="mt-3 text-sm font-bold text-orange-300">{busy}</p>}
            {error && <p className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
            <p className="mt-3 text-xs text-zinc-500">Restaurar pide el PIN de administrador.</p>
          </div>
        </section>
      </AppShell>
    </RequireRole>
  );
}
