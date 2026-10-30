"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import type { KitchenStation } from "@/data/products";
import { getCurrentUser } from "@/lib/auth";
import { requirePermissionOrAdmin } from "@/lib/permissions";
import { addAuditEvent } from "@/lib/audit";
import { isDeliverySale, printSale, saleStations, saleTicket, STATIONS, type SaleForTickets } from "@/lib/bridge/sale-tickets";

const ORDERS_KEY = "bpos_orders";
const DAYS = 3;

/**
 * Impresiones: ventas recientes (mostrador y delivery). "Reimprimir" abre
 * una ventana para elegir qué sale: comandas de ciertas estaciones, el
 * ticket del cliente (Caja) y, en delivery, el ticket original.
 */
function loadSales(): SaleForTickets[] {
  try {
    const all = JSON.parse(localStorage.getItem(ORDERS_KEY) || "[]") as SaleForTickets[];
    const since = Date.now() - DAYS * 24 * 60 * 60 * 1000;
    return (Array.isArray(all) ? all : [])
      .filter((o) => o && Array.isArray(o.items) && Date.parse(o.createdAt) >= since)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  } catch {
    return [];
  }
}

function when(iso: string) {
  return new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export default function ImpresionesPage() {
  const [sales, setSales] = useState<SaleForTickets[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SaleForTickets | null>(null);

  const refresh = useCallback(() => setSales(loadSales()), []);

  useEffect(() => {
    const first = window.setTimeout(refresh, 0);
    window.addEventListener("bpos:orders-updated", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("bpos:orders-updated", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sales;
    return sales.filter((s) => {
      const t = saleTicket(s);
      return `${t.platform} ${t.orderId} ${t.customer || ""} ${s.id}`.toLowerCase().includes(q);
    });
  }, [sales, query]);

  async function openReprint(sale: SaleForTickets) {
    const user = getCurrentUser();
    if (!(await requirePermissionOrAdmin(user, "printing.reprint", "reimprimir un pedido"))) return;
    setSelected(sale);
  }

  return (
    <AppShell title="Impresiones" subtitle={`Ventas de los últimos ${DAYS} días. Reimprime comandas, el ticket del cliente o el original de delivery.`}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar por pedido, plataforma o cliente"
        className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-white"
      />

      <div className="mt-6 space-y-3">
        {visible.length === 0 && (
          <div className="rounded-2xl border border-dashed border-zinc-800 p-10 text-center text-zinc-500">Todavía no hay ventas para reimprimir.</div>
        )}
        {visible.map((sale) => {
          const t = saleTicket(sale);
          return (
            <div key={sale.id} className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-5 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-black text-orange-400">
                  {isDeliverySale(sale) ? "🛵 " : "🧾 "}
                  {t.platform}
                </p>
                <h3 className="text-xl font-black text-white">
                  Pedido #{t.orderId}
                  {t.customer ? <span className="ml-2 text-base text-zinc-400">· {t.customer}</span> : null}
                </h3>
                <p className="mt-1 truncate text-sm text-zinc-400">
                  {when(sale.createdAt)} · {t.items.map((i) => `${i.qty}x ${i.name}`).join(", ")}
                </p>
                <p className="mt-1 text-xs text-zinc-500">Estaciones: {saleStations(sale).join(", ") || "—"}</p>
              </div>
              <div className="flex shrink-0 items-center gap-4">
                <span className="text-xl font-black text-white">${Number(sale.total || 0).toFixed(2)}</span>
                <button onClick={() => openReprint(sale)} className="rounded-2xl bg-orange-500 px-5 py-3 font-black text-black">
                  Reimprimir
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {selected && <ReprintDialog sale={selected} onClose={() => setSelected(null)} />}
    </AppShell>
  );
}

function ReprintDialog({ sale, onClose }: { sale: SaleForTickets; onClose: () => void }) {
  const delivery = isDeliverySale(sale);
  const used = saleStations(sale);
  const [stations, setStations] = useState<KitchenStation[]>(used);
  const [customer, setCustomer] = useState(true);
  const [original, setOriginal] = useState(false);
  const [busy, setBusy] = useState(false);
  const t = saleTicket(sale);

  function toggle(station: KitchenStation) {
    setStations((s) => (s.includes(station) ? s.filter((x) => x !== station) : [...s, station]));
  }

  async function print() {
    if (!stations.length && !customer && !original) {
      alert("Elige al menos una cosa para imprimir.");
      return;
    }
    setBusy(true);
    try {
      const failed = await printSale(sale, { stations, customer, original }, true);
      const user = getCurrentUser();
      const what = [stations.length ? `comandas (${stations.join(", ")})` : "", customer ? "ticket del cliente" : "", original ? "ticket original" : ""].filter(Boolean).join(", ");
      addAuditEvent({
        category: "Impresiones",
        action: "print.reprinted",
        description: `${user.name} reimprimió ${what} del pedido ${t.platform} #${t.orderId}`,
        userId: String(user.id),
        userName: user.name,
        entityId: String(sale.id),
      });
      if (failed.length) alert(`No salió en: ${failed.join(" · ")}`);
      else onClose();
    } catch {
      alert("No se pudo imprimir. Revisa que B-POS Agent esté conectado en la computadora de las impresoras.");
    } finally {
      setBusy(false);
    }
  }

  const box = "flex items-center gap-3 rounded-2xl border border-zinc-800 bg-black p-4 font-bold";
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-lg rounded-3xl border border-zinc-700 bg-zinc-950 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-black text-orange-400">¿Qué quieres reimprimir?</p>
            <h2 className="text-2xl font-black text-white">
              {t.platform} · Pedido #{t.orderId}
            </h2>
          </div>
          <button onClick={onClose} className="text-2xl text-zinc-400" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <p className="mt-5 text-sm font-black text-zinc-400">Comandas</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {STATIONS.map((station) => (
            <label key={station} className={`${box} ${used.includes(station) ? "" : "opacity-40"}`}>
              <input type="checkbox" checked={stations.includes(station)} disabled={!used.includes(station)} onChange={() => toggle(station)} />
              {station}
            </label>
          ))}
        </div>

        <p className="mt-5 text-sm font-black text-zinc-400">Tickets</p>
        <div className="mt-2 grid gap-2">
          <label className={box}>
            <input type="checkbox" checked={customer} onChange={(e) => setCustomer(e.target.checked)} />
            Ticket del cliente {delivery ? "(el de la bolsa)" : ""} · Caja
          </label>
          {delivery && (
            <label className={box}>
              <input type="checkbox" checked={original} onChange={(e) => setOriginal(e.target.checked)} />
              Ticket original de {t.platform} · Caja
            </label>
          )}
        </div>

        <button onClick={() => void print()} disabled={busy} className="mt-6 w-full rounded-2xl bg-orange-500 py-4 font-black text-black disabled:opacity-50">
          {busy ? "Imprimiendo..." : "Imprimir"}
        </button>
      </div>
    </div>
  );
}
