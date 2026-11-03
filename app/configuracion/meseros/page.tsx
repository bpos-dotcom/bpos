"use client";
/**
 * Configuración → Meseros: la liga de la app de meseros, el código para
 * vincular cada celular y la lista de celulares vinculados (con Desvincular).
 * Quién puede tomar órdenes y si está en turno se maneja en Usuarios
 * (rol Mesero) y en el checador.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { ask, notify } from "@/components/layout/Dialogs";
import { AppShell } from "@/components/layout/AppShell";
import { loadCloudAccount } from "@/lib/cloud/account";
import { getDigitalMenu } from "@/lib/digital-menu";
import { PUSH_SERVER } from "@/lib/push/rules";
import { isCloudConfigured } from "@/lib/supabase/client";
import { listWaiterDevices, newWaiterCode, revokeWaiterDevice, type WaiterDeviceRow } from "@/lib/waiter";
import { waiterUsers } from "@/lib/waiter";

export default function MeserosPage() {
  const [branchId, setBranchId] = useState("");
  const [slug, setSlug] = useState("");
  const [devices, setDevices] = useState<WaiterDeviceRow[]>([]);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [waiters, setWaiters] = useState(0);

  useEffect(() => {
    setSlug(getDigitalMenu().slug || "");
    setWaiters(waiterUsers().length);
    if (!isCloudConfigured) return;
    loadCloudAccount()
      .then((acc) => {
        if (acc.status !== "ready") return;
        setBranchId(acc.branchId);
        return listWaiterDevices(acc.branchId).then(setDevices);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar."));
  }, []);

  const link = slug ? `${PUSH_SERVER}/meseros/${slug}` : "";

  async function generate() {
    setBusy(true);
    setError("");
    try {
      setCode(await newWaiterCode(branchId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar el código.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(d: WaiterDeviceRow) {
    if (!(await ask(`¿Desvincular "${d.name}"? Ese celular ya no podrá tomar órdenes hasta vincularlo otra vez.`, { ok: "Desvincular" }))) return;
    try {
      await revokeWaiterDevice(d.id);
      setDevices((list) => list.filter((x) => x.id !== d.id));
      notify("Celular desvinculado.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "No se pudo desvincular.", "error");
    }
  }

  return (
    <RequireRole allow={["Admin", "Gerente"]}>
      <AppShell title="Meseros" subtitle="La app de meseros en el celular: toman la orden en la mesa y la mandan a cocina.">
        <div className="max-w-3xl space-y-6">
          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <h2 className="text-xl font-black text-orange-500">1. La dirección para los meseros</h2>
            {link ? (
              <>
                <p className="mt-3 break-all rounded-2xl bg-black px-4 py-3 font-mono text-lg font-black text-white">{link}</p>
                <button onClick={() => navigator.clipboard?.writeText(link).then(() => notify("Dirección copiada."))} className="mt-3 rounded-xl border border-zinc-700 px-4 py-2 text-sm font-black">
                  Copiar dirección
                </button>
                <p className="mt-3 text-sm text-zinc-400">Los meseros la abren en el navegador de su celular y la agregan a la pantalla de inicio. Funciona con la misma liga del menú digital.</p>
              </>
            ) : (
              <p className="mt-3 text-sm text-zinc-400">
                Primero define la liga de tu negocio en <Link href="/configuracion/menu-digital" className="font-black text-orange-400">Menú digital</Link> (ej. burger-planet). La app de meseros usa la misma.
              </p>
            )}
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <h2 className="text-xl font-black text-orange-500">2. Vincular un celular</h2>
            <p className="mt-2 text-sm text-zinc-400">La primera vez que abren la dirección, el celular pide un código. Genera uno aquí y díctaselo: dura 15 minutos y sirve para un solo celular.</p>
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
            <h2 className="text-xl font-black text-orange-500">3. Celulares vinculados</h2>
            {devices.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-500">Todavía no hay celulares vinculados.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {devices.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-black p-4">
                    <div>
                      <p className="font-black">{d.name}</p>
                      <p className="text-xs text-zinc-500">
                        Vinculado el {new Date(d.created_at).toLocaleDateString("es-MX")}
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
            <h2 className="text-xl font-black text-orange-500">Quién puede y cuándo</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                Entran con su nombre y PIN los usuarios con rol <b className="text-white">Mesero</b> (o con el permiso &quot;Tomar órdenes en la app de meseros&quot;). Hoy hay {waiters}. Se dan de alta en{" "}
                <Link href="/configuracion/usuarios" className="font-black text-orange-400">Usuarios</Link>.
              </li>
              <li>
                Solo mandan comandas <b className="text-white">en turno</b>: cuando marcaron entrada en el <Link href="/checador" className="font-black text-orange-400">checador</Link>. En Usuarios puedes poner a un mesero &quot;siempre&quot; o &quot;cortado&quot; al momento.
              </li>
              <li>
                Fuera del <Link href="/configuracion/menu-digital" className="font-black text-orange-400">horario de servicio</Link> del menú digital, las comandas quedan cerradas para todos. Un administrador puede abrir una excepción de 2 horas con su PIN desde el celular.
              </li>
              <li>Cada comanda queda en la bitácora con el mesero y la mesa. Los intentos fuera de turno u horario también, y le avisan al dueño.</li>
              <li>El mesero no cobra: la cuenta aparece en el POS (Mesas) para cobrarla en caja.</li>
            </ul>
          </section>
        </div>
      </AppShell>
    </RequireRole>
  );
}
