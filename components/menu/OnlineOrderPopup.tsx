"use client";
/**
 * "🌐 Llegó un pedido del menú digital": sale en cualquier pantalla de B-POS
 * (como la de Productividad). Los pedidos normales ya suenan con el aviso de
 * Configuración → Notificaciones; los programados suenan aquí, porque antes
 * llegaban sin avisar a nadie.
 */
import { useRouter } from "next/navigation";
import { useAlertSettings, useAlertSound } from "@/lib/notifications/useAlert";
import { dismissPopup, type OnlinePopupOrder } from "@/lib/online-orders-popup";

const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;

export function OnlineOrderPopup({ orders }: { orders: OnlinePopupOrder[] }) {
  const router = useRouter();
  const alerts = useAlertSettings();
  const later = orders.filter((o) => o.later);
  useAlertSound("online-order", alerts["online-order"], later.length > 0, later.map((o) => o.id).sort().join(","));
  if (!orders.length) return null;
  const ids = orders.map((o) => o.id);

  return (
    <div className="fixed inset-0 z-[85] flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-[10vh]">
      <div className="w-full max-w-lg rounded-3xl border-2 border-emerald-500 bg-zinc-950 p-5 text-white shadow-[0_0_60px_rgba(34,197,94,0.45)]">
        <p className="text-sm font-black text-emerald-300">🌐 {orders.length === 1 ? "Llegó un pedido" : `Llegaron ${orders.length} pedidos`} del menú digital</p>
        <div className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto">
          {orders.map((o) => (
            <div key={o.id} className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-2xl font-black tracking-widest">{o.folio}</p>
                <p className="text-xl font-black text-orange-400">{money(o.total)}</p>
              </div>
              <p className="text-sm text-zinc-300">
                {o.label}
                {o.name ? ` · ${o.name}` : ""}
              </p>
              {o.scheduled && <p className="mt-1 text-sm font-black text-sky-300">📅 Programado para {o.scheduled}</p>}
              {o.quote && <p className="mt-1 text-sm font-black text-orange-300">🚚 Falta poner el costo de envío</p>}
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              dismissPopup(ids);
              router.push("/pedidos-en-linea");
            }}
            className="rounded-2xl bg-emerald-500 px-4 py-3 font-black text-black"
          >
            Ver pedido{orders.length === 1 ? "" : "s"}
          </button>
          <button type="button" onClick={() => dismissPopup(ids)} className="rounded-2xl border border-zinc-700 px-4 py-3 font-black text-zinc-300">
            Enterado
          </button>
        </div>
      </div>
    </div>
  );
}
