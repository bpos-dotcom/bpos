"use client";
/**
 * Configuración → Reparto: repartidores del negocio con su WhatsApp. Al salir
 * un pedido a domicilio (menú digital o POS) se elige a uno y le llega todo
 * el pedido por WhatsApp. Cuántos repartió cada uno en los últimos 30 días.
 */
import { useEffect, useMemo, useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import { whatsappNumber } from "@/lib/digital-menu";
import { DRIVERS_EVENT, getDrivers, saveDrivers, type Driver } from "@/lib/drivers";

const input = "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white";

export default function RepartoPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [trips, setTrips] = useState<Record<string, number>>({});

  useEffect(() => {
    const sync = () => setDrivers(getDrivers());
    sync();
    // Pedidos que llevó cada uno (últimos 30 días)
    try {
      const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const orders = JSON.parse(localStorage.getItem("bpos_orders") || "[]") as { createdAt?: string; driver?: { id: string } }[];
      const count: Record<string, number> = {};
      orders.forEach((o) => {
        if (o.driver?.id && Date.parse(o.createdAt || "") > since) count[o.driver.id] = (count[o.driver.id] || 0) + 1;
      });
      // eslint-disable-next-line react-hooks/set-state-in-effect -- datos del navegador: solo después de montar
      setTrips(count);
    } catch {}
    window.addEventListener(DRIVERS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(DRIVERS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  function persist(list: Driver[]) {
    setDrivers(list);
    saveDrivers(list);
  }

  function add() {
    setError("");
    if (!name.trim()) return setError("Escribe el nombre del repartidor.");
    if (!whatsappNumber(phone)) return setError("Escribe su WhatsApp a 10 dígitos.");
    persist([...drivers, { id: `rep-${Date.now().toString(36)}`, name: name.trim().slice(0, 40), phone: phone.replace(/\D/g, ""), active: true }]);
    setName("");
    setPhone("");
  }

  const sorted = useMemo(() => [...drivers].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "es")), [drivers]);

  return (
    <RequireRole allow={["Admin"]}>
      <AppShell title="Reparto" subtitle="Tus repartidores: al salir un pedido a domicilio eliges quién lo lleva y le llega por WhatsApp.">
        <div className="max-w-3xl space-y-5">
          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <h2 className="text-lg font-black">➕ Nuevo repartidor</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" maxLength={40} className={input} />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="WhatsApp (10 dígitos)" inputMode="tel" maxLength={13} className={input} />
              <button onClick={add} className="rounded-2xl bg-orange-500 px-6 py-3 font-black text-black">
                Agregar
              </button>
            </div>
            {error && <p className="mt-2 text-sm font-bold text-red-300">{error}</p>}
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <h2 className="text-lg font-black">🛵 Repartidores</h2>
            <div className="mt-4 space-y-2">
              {sorted.map((d) => (
                <div key={d.id} className={`grid gap-3 rounded-2xl border p-4 md:grid-cols-[1fr_1fr_auto_auto] ${d.active ? "border-zinc-700 bg-black" : "border-zinc-900 bg-black/40 opacity-60"}`}>
                  <input value={d.name} onChange={(e) => persist(drivers.map((x) => (x.id === d.id ? { ...x, name: e.target.value.slice(0, 40) } : x)))} className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2" />
                  <input
                    value={d.phone}
                    inputMode="tel"
                    onChange={(e) => persist(drivers.map((x) => (x.id === d.id ? { ...x, phone: e.target.value.replace(/\D/g, "").slice(0, 13) } : x)))}
                    className={`rounded-xl border bg-zinc-950 px-3 py-2 ${whatsappNumber(d.phone) ? "border-zinc-800" : "border-red-500"}`}
                  />
                  <span className="self-center text-sm text-zinc-400">{trips[d.id] || 0} pedidos (30 días)</span>
                  <div className="flex gap-2">
                    <button onClick={() => persist(drivers.map((x) => (x.id === d.id ? { ...x, active: !x.active } : x)))} className={`rounded-xl px-3 py-2 text-sm font-black ${d.active ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-800 text-zinc-400"}`}>
                      {d.active ? "Activo" : "Inactivo"}
                    </button>
                    <button
                      onClick={() => confirm(`¿Quitar a ${d.name}?`) && persist(drivers.filter((x) => x.id !== d.id))}
                      className="rounded-xl border border-zinc-800 px-3 py-2 text-sm text-zinc-400 hover:border-red-500"
                      aria-label={`Quitar a ${d.name}`}
                    >
                      🗑
                    </button>
                  </div>
                </div>
              ))}
              {drivers.length === 0 && <p className="text-sm text-zinc-500">Todavía no tienes repartidores.</p>}
            </div>
          </section>
        </div>
      </AppShell>
    </RequireRole>
  );
}
