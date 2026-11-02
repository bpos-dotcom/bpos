"use client";
/**
 * Configuración → Mesas: las mesas del restaurante, por zona (Salón, Terraza,
 * Barra...). En el POS, el botón "Mesas" las muestra para abrir una cuenta
 * de mesa: se mandan rondas a cocina, se saca la precuenta y se cobra.
 */
import { useEffect, useMemo, useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import { DEFAULT_ZONE, getTables, saveTables, TABLES_EVENT, tableZones, type Table } from "@/lib/tables";

const input = "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white";

export default function MesasPage() {
  const [tables, setTables] = useState<Table[]>([]);
  const [name, setName] = useState("");
  const [zone, setZone] = useState(DEFAULT_ZONE);
  const [seats, setSeats] = useState("4");
  const [count, setCount] = useState("10");
  const [error, setError] = useState("");

  useEffect(() => {
    const sync = () => setTables(getTables());
    sync();
    window.addEventListener(TABLES_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(TABLES_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  function persist(list: Table[]) {
    setTables(list);
    saveTables(list);
  }
  const newId = () => `mesa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const zoneName = () => zone.trim().slice(0, 30) || DEFAULT_ZONE;

  function add() {
    setError("");
    const n = name.trim().slice(0, 30);
    if (!n) return setError("Escribe el nombre o número de la mesa.");
    if (tables.some((t) => t.name.toLowerCase() === n.toLowerCase() && t.zone === zoneName())) return setError(`Ya hay una mesa "${n}" en ${zoneName()}.`);
    persist([...tables, { id: newId(), name: n, zone: zoneName(), seats: Number(seats) || 0, active: true }]);
    setName("");
  }

  /** Crea varias de un jalón: 1, 2, 3... siguiendo el número más alto de la zona */
  function addMany() {
    setError("");
    const howMany = Math.max(1, Math.min(60, Math.round(Number(count) || 0)));
    const z = zoneName();
    const highest = tables.filter((t) => t.zone === z).reduce((max, t) => Math.max(max, Number(t.name) || 0), 0);
    const created: Table[] = [];
    for (let i = 1; i <= howMany; i++) created.push({ id: newId(), name: String(highest + i), zone: z, seats: Number(seats) || 0, active: true });
    persist([...tables, ...created]);
  }

  function update(id: string, patch: Partial<Table>) {
    persist(tables.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function remove(id: string) {
    const t = tables.find((x) => x.id === id);
    if (!t || !confirm(`¿Quitar la mesa ${t.name} (${t.zone})?`)) return;
    persist(tables.filter((x) => x.id !== id));
  }

  const zones = useMemo(() => tableZones(tables), [tables]);

  return (
    <RequireRole allow={["Admin"]}>
      <AppShell title="Mesas" subtitle="Las mesas de tu restaurante por zona. En el POS eliges la mesa, mandas rondas a cocina, sacas la precuenta y cobras.">
        <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
          <section className="space-y-5">
            <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
              <h2 className="text-xl font-black text-orange-500">Agregar mesa</h2>
              <div className="mt-4 space-y-3">
                <label className="block text-sm font-bold text-zinc-400">
                  Zona
                  <input value={zone} onChange={(e) => setZone(e.target.value)} list="zonas" placeholder="Salón, Terraza, Barra..." className={`${input} mt-1`} />
                  <datalist id="zonas">
                    {zones.map((z) => (
                      <option key={z} value={z} />
                    ))}
                  </datalist>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-sm font-bold text-zinc-400">
                    Mesa (nombre o número)
                    <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Ej. 7 o Ventana" className={`${input} mt-1`} />
                  </label>
                  <label className="block text-sm font-bold text-zinc-400">
                    Lugares
                    <input value={seats} onChange={(e) => setSeats(e.target.value)} type="number" min={0} max={99} inputMode="numeric" className={`${input} mt-1`} />
                  </label>
                </div>
                {error && <p className="text-sm font-bold text-red-400">{error}</p>}
                <button onClick={add} className="w-full rounded-2xl bg-orange-500 py-3 font-black text-black">
                  Agregar mesa
                </button>
              </div>
              <div className="mt-5 border-t border-zinc-800 pt-4">
                <p className="text-sm font-bold text-zinc-400">O crea varias numeradas de un jalón</p>
                <div className="mt-2 flex gap-2">
                  <input value={count} onChange={(e) => setCount(e.target.value)} type="number" min={1} max={60} inputMode="numeric" className="w-24 shrink-0 rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-center text-white" />
                  <button onClick={addMany} className="flex-1 rounded-2xl border border-orange-500 px-4 py-3 font-black text-orange-300 hover:bg-orange-500/10">
                    Crear mesas en {zoneName()}
                  </button>
                </div>
                <p className="mt-2 text-xs text-zinc-500">Siguen la numeración de la zona (si ya hay 1 a 8, crea de la 9 en adelante).</p>
              </div>
            </div>
            <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6 text-sm text-zinc-400">
              <p className="font-black text-white">Cómo se usa en el POS</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Toca <b>Mesas</b>, elige la mesa y cuántas personas.</li>
                <li>Marca los productos y toca <b>Mandar a cocina</b>: la cuenta queda abierta en esa mesa.</li>
                <li>Para pedir más, vuelve a tocar la mesa y agrega otra ronda.</li>
                <li>Saca la <b>precuenta</b> y cobra cuando pidan la cuenta, completa o dividida.</li>
              </ol>
            </div>
          </section>

          <section className="space-y-5">
            {tables.length === 0 && (
              <div className="rounded-3xl border border-dashed border-zinc-800 p-10 text-center text-zinc-500">Todavía no hay mesas. Agrega la primera o crea varias numeradas.</div>
            )}
            {zones.map((z) => (
              <div key={z} className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-black text-orange-500">{z}</h2>
                  <p className="text-sm text-zinc-500">{tables.filter((t) => t.zone === z).length} mesas</p>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {tables
                    .filter((t) => t.zone === z)
                    .map((t) => (
                      <div key={t.id} className={`rounded-2xl border p-4 ${t.active ? "border-zinc-800 bg-black" : "border-zinc-900 bg-zinc-950 opacity-60"}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">🪑</span>
                          <input value={t.name} onChange={(e) => update(t.id, { name: e.target.value.slice(0, 30) })} className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 font-black text-white" aria-label="Nombre de la mesa" />
                        </div>
                        <div className="mt-3 flex items-center gap-2 text-sm">
                          <label className="flex items-center gap-1 text-zinc-400">
                            Lugares
                            <input value={t.seats || ""} onChange={(e) => update(t.id, { seats: Number(e.target.value) || 0 })} type="number" min={0} max={99} className="w-16 rounded-xl border border-zinc-800 bg-zinc-950 px-2 py-1 text-white" />
                          </label>
                          <select value={t.zone} onChange={(e) => update(t.id, { zone: e.target.value })} className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-2 py-1 text-white" aria-label="Zona">
                            {zones.map((zz) => (
                              <option key={zz}>{zz}</option>
                            ))}
                          </select>
                        </div>
                        <div className="mt-3 flex justify-between text-xs font-black">
                          <button onClick={() => update(t.id, { active: !t.active })} className="text-zinc-400 hover:text-orange-400">
                            {t.active ? "Desactivar" : "Activar"}
                          </button>
                          <button onClick={() => remove(t.id)} className="text-red-400 hover:text-red-300">
                            Quitar
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </section>
        </div>
      </AppShell>
    </RequireRole>
  );
}
