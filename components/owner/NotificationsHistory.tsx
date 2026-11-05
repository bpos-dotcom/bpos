"use client";
/**
 * App del dueño → 🔔 Avisos: historial de las notificaciones (pedidos de
 * delivery, ventas grandes, cortes, cancelaciones, seguridad), con el mismo
 * texto del aviso, para ver a qué se refería uno después de tocarlo.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { loadOwnerNotifications } from "@/lib/cloud/audit-outbox";
import { getPushPrefs } from "@/lib/push/client";

type Item = NonNullable<Awaited<ReturnType<typeof loadOwnerNotifications>>>[number];

function when(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  const time = d.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Hoy ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Ayer ${time}`;
  return `${d.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" })} ${time}`;
}

export function NotificationsHistory() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const list = await loadOwnerNotifications(getPushPrefs());
      if (list === null) setError("Inicia sesión con la cuenta del negocio para ver los avisos.");
      else {
        setItems(list);
        setError("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los avisos.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial y cada 30 s
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-black">🔔 Avisos</h2>
        <button onClick={load} className="text-xs font-black text-orange-500">
          Actualizar
        </button>
      </div>
      <p className="mb-3 text-xs text-zinc-500">Las notificaciones que te llegan al celular, de la más nueva a la más vieja. Cuáles te llegan se elige en Resumen → Esta app.</p>
      {error && <p className="rounded-2xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      {!error && items === null && <p className="py-8 text-center text-sm text-zinc-500">Cargando avisos...</p>}
      {items && items.length === 0 && <p className="py-8 text-center text-sm text-zinc-500">Todavía no hay avisos.</p>}
      {items && items.length > 0 && (
        <ul className="divide-y divide-zinc-800">
          {items.map((n) => (
            <li key={n.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="font-black">{n.title}</p>
                <span className="shrink-0 text-[11px] text-zinc-500">{when(n.at)}</span>
              </div>
              <p className="mt-0.5 text-sm text-zinc-300">{n.body}</p>
              <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                <span>{n.by ? `Por ${n.by}` : ""}</span>
                {!n.url.startsWith("/dueno") && (
                  <Link href={n.url} className="font-black text-orange-500">
                    Ver detalle →
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
