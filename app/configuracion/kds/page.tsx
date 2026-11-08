"use client";
/**
 * Configuración → Tablets de cocina: la liga de la app de cocina
 * (bpos.com.mx/kds/<liga>), el código para vincular cada tablet y la lista
 * de tablets vinculadas (con Desvincular). Igual que Meseros.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { ask, notify } from "@/components/layout/Dialogs";
import { AppShell } from "@/components/layout/AppShell";
import { loadCloudAccount } from "@/lib/cloud/account";
import { getDigitalMenu } from "@/lib/digital-menu";
import { kitchenUsers } from "@/lib/kds-device";
import { PUSH_SERVER } from "@/lib/push/rules";
import { isCloudConfigured } from "@/lib/supabase/client";
import { listWaiterDevices, newWaiterCode, revokeWaiterDevice, type WaiterDeviceRow } from "@/lib/waiter";

export default function KdsTabletsPage() {
  const [branchId, setBranchId] = useState("");
  const [slug, setSlug] = useState("");
  const [devices, setDevices] = useState<WaiterDeviceRow[]>([]);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cooks, setCooks] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lee la liga y los usuarios guardados al abrir
    setSlug(getDigitalMenu().slug || "");
    setCooks(kitchenUsers().length);
    if (!isCloudConfigured) return;
    loadCloudAccount()
      .then((acc) => {
        if (acc.status !== "ready") return;
        setBranchId(acc.branchId);
        return listWaiterDevices(acc.branchId, "kds").then(setDevices);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar."));
  }, []);

  const link = slug ? `${PUSH_SERVER}/kds/${slug}` : "";

  async function generate() {
    setBusy(true);
    setError("");
    try {
      setCode(await newWaiterCode(branchId, "kds"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar el código.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(d: WaiterDeviceRow) {
    if (!(await ask(`¿Desvincular "${d.name}"? Esa tablet ya no verá los pedidos hasta vincularla otra vez.`, { ok: "Desvincular" }))) return;
    try {
      await revokeWaiterDevice(d.id);
      setDevices((list) => list.filter((x) => x.id !== d.id));
      notify("Tablet desvinculada.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "No se pudo desvincular.", "error");
    }
  }

  return (
    <RequireRole allow={["Admin", "Gerente"]}>
      <AppShell title="Tablets de cocina" subtitle="La pantalla de cocina (KDS) en tablets: se vinculan con un código y cada quien entra con su PIN.">
        <div className="max-w-3xl space-y-6">
          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <h2 className="text-xl font-black text-orange-500">1. La dirección para las tablets</h2>
            {link ? (
              <>
                <p className="mt-3 break-all rounded-2xl bg-black px-4 py-3 font-mono text-lg font-black text-white">{link}</p>
                <button onClick={() => navigator.clipboard?.writeText(link).then(() => notify("Dirección copiada."))} className="mt-3 rounded-xl border border-zinc-700 px-4 py-2 text-sm font-black">
                  Copiar dirección
                </button>
                <p className="mt-3 text-sm text-zinc-400">Ábrela en el navegador de la tablet y agrégala a la pantalla de inicio: queda como app de cocina a pantalla completa, sin el resto de B-POS.</p>
              </>
            ) : (
              <p className="mt-3 text-sm text-zinc-400">
                Primero define la liga de tu negocio en <Link href="/configuracion/menu-digital" className="font-black text-orange-400">Menú digital</Link> (ej. burger-planet). La app de cocina usa la misma.
              </p>
            )}
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <h2 className="text-xl font-black text-orange-500">2. Vincular una tablet</h2>
            <p className="mt-2 text-sm text-zinc-400">La primera vez que abren la dirección, la tablet pide un código. Genera uno aquí: dura 15 minutos y sirve para una sola tablet. No hace falta el correo ni la contraseña del restaurante.</p>
            {code ? (
              <div className="mt-4 rounded-2xl border border-orange-500/40 bg-black p-5 text-center">
                <p className="text-5xl font-black tracking-[0.3em] text-orange-400">{code.code}</p>
                <p className="mt-2 text-xs text-zinc-500">Vence a las {new Date(code.expiresAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</p>
              </div>
            ) : null}
            <button onClick={generate} disabled={busy || !branchId || !slug} className="mt-4 rounded-2xl bg-orange-500 px-5 py-3 font-black text-black disabled:opacity-50">
              {busy ? "Generando…" : code ? "Otro código" : "Generar código"}
            </button>
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <h2 className="text-xl font-black text-orange-500">3. Tablets vinculadas</h2>
            {devices.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-500">Todavía no hay tablets vinculadas.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {devices.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-black p-4">
                    <div>
                      <p className="font-black">{d.name}</p>
                      <p className="text-xs text-zinc-500">
                        Vinculada el {new Date(d.created_at).toLocaleDateString("es-MX")}
                        {d.last_seen_at ? ` · última vez ${new Date(d.last_seen_at).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}` : ""}
                      </p>
                    </div>
                    <button onClick={() => void revoke(d)} className="rounded-xl border border-red-500/50 px-3 py-2 text-xs font-black text-red-300">
                      Desvincular
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6 text-sm text-zinc-400">
            <h2 className="text-xl font-black text-orange-500">Quién entra y qué ve</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                Entran con su nombre y PIN los usuarios con rol <b className="text-white">Cocina</b> (o con el permiso &quot;Ver Cocina KDS&quot;). Hoy hay {cooks}. Se dan de alta en{" "}
                <Link href="/configuracion/usuarios" className="font-black text-orange-400">Usuarios</Link>.
              </li>
              <li>Ven los pedidos por estación (parrilla, freidora, barra...) con sus tiempos y los marcan como listos. Cada tablet puede quedarse en su estación.</li>
              <li>No ven la caja, ni el resto de B-POS, ni los avisos de equivalencias del Bridge: eso solo sale en la caja principal.</li>
            </ul>
          </section>
        </div>
      </AppShell>
    </RequireRole>
  );
}
