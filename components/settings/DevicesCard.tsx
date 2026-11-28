"use client";
/**
 * Configuración → Sistema → Dispositivos (también en la App del dueño):
 * los equipos con sesión abierta en el negocio, cuándo entraron, la última
 * vez que se usaron y su ubicación aproximada (por su internet). Desde aquí
 * se les pone nombre, se cierran sesiones viejas y se elige la caja
 * principal de cada sucursal, desde cualquier equipo.
 */
import { useCallback, useEffect, useState } from "react";
import { ask, askText, notify } from "@/components/layout/Dialogs";
import {
  agoText,
  closeDevice,
  closeOtherDevices,
  DEVICES_EVENT,
  deviceAccount,
  isOnline,
  listDevices,
  pingDeviceNow,
  placeOf,
  renameDevice,
  setCloudPrimary,
  type DeviceRow,
} from "@/lib/cloud/devices";

const ICON: Record<string, string> = { "app-dueno": "📱", "caja-local": "🖥️", cocina: "👨‍🍳", mesero: "🧑‍🍽️", navegador: "💻" };
const CAN_BE_PRIMARY = ["navegador", "caja-local"];

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : "—");

export function DevicesCard({ className = "" }: { className?: string }) {
  const [acc, setAcc] = useState<ReturnType<typeof deviceAccount>>(null);
  const [rows, setRows] = useState<DeviceRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const a = deviceAccount();
    setAcc(a);
    if (!a) return;
    try {
      setRows(await listDevices(a.businessId));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la lista.");
    }
    setNow(Date.now());
  }, []);

  useEffect(() => {
    // La sincronización arranca un momento después de abrir: se vuelve a intentar hasta que esté
    const now0 = setTimeout(() => void load(), 0);
    const first = setTimeout(() => void load(), 3000);
    const every = setInterval(() => void load(), 60_000);
    const onChange = () => void load();
    window.addEventListener(DEVICES_EVENT, onChange);
    return () => {
      clearTimeout(now0);
      clearTimeout(first);
      clearInterval(every);
      window.removeEventListener(DEVICES_EVENT, onChange);
    };
  }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      await fn();
      if (done) notify(done);
      await pingDeviceNow();
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "No se pudo.", "error");
    } finally {
      setBusy("");
    }
  };

  if (!acc) {
    return (
      <section className={`rounded-3xl border border-zinc-800 bg-zinc-950 p-6 ${className}`}>
        <h2 className="text-lg font-black">📲 Dispositivos</h2>
        <p className="mt-2 text-sm text-zinc-400">Este equipo no está conectado a la nube (o todavía está entrando). La lista sale cuando termine de sincronizar.</p>
      </section>
    );
  }

  const list = [...(rows || [])].sort((a, b) => Number(b.device_id === acc.deviceId) - Number(a.device_id === acc.deviceId));
  const others = list.filter((d) => d.device_id !== acc.deviceId && !d.revoked_at && d.email && d.email === list.find((x) => x.device_id === acc.deviceId)?.email);
  const manyBranches = new Set(list.map((d) => d.branch_id)).size > 1;

  return (
    <section className={`rounded-3xl border border-zinc-800 bg-zinc-950 p-6 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-black">📲 Dispositivos</h2>
          <p className="mt-1 text-sm text-zinc-400">Equipos con la sesión abierta en tu negocio. Cierra los que ya no uses y elige aquí cuál es la caja principal.</p>
        </div>
        {others.length > 0 && (
          <button
            disabled={Boolean(busy)}
            onClick={async () => {
              if (!(await ask(`¿Cerrar la sesión de los otros ${others.length} equipos de tu cuenta? Este se queda abierto. Los de meseros y cocina no se tocan.`, { ok: "Cerrar los demás" }))) return;
              await run("all", () => closeOtherDevices(acc.businessId, acc.deviceId), "Listo: se cerraron los demás equipos.");
            }}
            className="shrink-0 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-black text-red-300 disabled:opacity-50"
          >
            Cerrar todos los demás
          </button>
        )}
      </div>

      {error && <p className="mt-3 rounded-2xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      {!rows && !error && <p className="mt-4 text-sm text-zinc-500">Cargando…</p>}
      {rows && rows.length === 0 && <p className="mt-4 text-sm text-zinc-500">Todavía no se ha reportado ningún equipo.</p>}

      <ul className="mt-4 space-y-3">
        {list.map((d) => {
          const mine = d.device_id === acc.deviceId;
          const closed = Boolean(d.revoked_at);
          const online = !closed && isOnline(d.last_seen_at, now);
          const place = placeOf(d);
          return (
            <li key={d.device_id} className={`rounded-2xl border p-4 ${mine ? "border-orange-500/60 bg-orange-500/5" : "border-zinc-800 bg-black"} ${closed ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-black">
                    {ICON[d.kind] || "💻"} {d.name || d.label || "Equipo"}
                  </p>
                  {d.name && d.label && <p className="text-xs text-zinc-500">{d.label}</p>}
                  <div className="mt-2 flex flex-wrap gap-2 text-xs font-black">
                    {mine && <span className="rounded-full bg-orange-500 px-2 py-0.5 text-black">Este dispositivo</span>}
                    {d.is_primary && <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-emerald-300">⭐ Caja principal</span>}
                    {closed ? (
                      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-red-300">Sesión cerrada</span>
                    ) : (
                      <span className={`rounded-full px-2 py-0.5 ${online ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-800 text-zinc-400"}`}>{online ? "● En uso" : `Último uso ${agoText(d.last_seen_at, now)}`}</span>
                    )}
                  </div>
                  <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs text-zinc-400 sm:grid-cols-2">
                    <div>
                      <dt className="inline text-zinc-500">Entró: </dt>
                      <dd className="inline">{when(d.first_seen_at)}</dd>
                    </div>
                    <div>
                      <dt className="inline text-zinc-500">Último uso: </dt>
                      <dd className="inline">{when(d.last_seen_at)}</dd>
                    </div>
                    <div>
                      <dt className="inline text-zinc-500">Ubicación aprox.: </dt>
                      <dd className="inline">
                        {place || "sin dato"}
                        {d.ip ? ` · IP ${d.ip}` : ""}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline text-zinc-500">Cuenta: </dt>
                      <dd className="inline break-all">
                        {d.email || "—"}
                        {manyBranches && d.branch_name ? ` · ${d.branch_name}` : ""}
                      </dd>
                    </div>
                  </dl>
                </div>
                {!closed && (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      disabled={Boolean(busy)}
                      onClick={async () => {
                        const name = await askText("Nombre de este equipo (ej. Caja mostrador, Celular de Gerardo)", { defaultValue: d.name || "" });
                        if (name === null) return;
                        await run(`n-${d.device_id}`, () => renameDevice(acc.businessId, d.device_id, name.trim()));
                      }}
                      className="rounded-xl border border-zinc-700 px-3 py-2 text-xs font-black text-zinc-300 disabled:opacity-50"
                    >
                      ✏️ Nombre
                    </button>
                    {d.is_primary ? (
                      <button
                        disabled={Boolean(busy)}
                        onClick={async () => {
                          if (!(await ask("¿Quitar la caja principal? Ningún equipo procesará solo los pedidos de Uber, DiDi y Rappi ni descontará el inventario de las ventas hasta que elijas otra.", { ok: "Quitar" }))) return;
                          await run(`p-${d.device_id}`, () => setCloudPrimary(acc.businessId, d.branch_id || acc.branchId, null), "Ya no hay caja principal en esa sucursal.");
                        }}
                        className="rounded-xl border border-zinc-700 px-3 py-2 text-xs font-black text-zinc-300 disabled:opacity-50"
                      >
                        Quitar principal
                      </button>
                    ) : (
                      CAN_BE_PRIMARY.includes(d.kind) && (
                        <button
                          disabled={Boolean(busy)}
                          onClick={async () => {
                            if (!(await ask(`¿Hacer "${d.name || d.label}" la caja principal? La que lo era deja de serlo en unos segundos.`, { ok: "Hacer principal" }))) return;
                            await run(`p-${d.device_id}`, () => setCloudPrimary(acc.businessId, d.branch_id || acc.branchId, d.device_id), "Listo: es la nueva caja principal.");
                          }}
                          className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-black text-black disabled:opacity-50"
                        >
                          ⭐ Hacer principal
                        </button>
                      )
                    )}
                    {!mine && (
                      <button
                        disabled={Boolean(busy)}
                        onClick={async () => {
                          if (!(await ask(`¿Cerrar la sesión de "${d.name || d.label}"? Sube lo que tenga pendiente y para volver a usarlo hay que entrar con la cuenta y contraseña.`, { ok: "Cerrar sesión" }))) return;
                          await run(`c-${d.device_id}`, () => closeDevice(acc.businessId, d.device_id), "Sesión cerrada.");
                        }}
                        className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-black text-red-300 disabled:opacity-50"
                      >
                        Cerrar sesión
                      </button>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-xs text-zinc-500">La ubicación sale del internet de cada equipo y es aproximada (a veces marca la ciudad de la compañía de internet). Un equipo aparece aquí cuando abre B-POS; uno que lleva días apagado sale cuando lo prendan.</p>
    </section>
  );
}
