"use client";
/**
 * Configuración → Cena del personal: quiénes tienen cena, qué días les toca,
 * qué pueden elegir, el tope por cena y a qué hora empieza el día.
 * Se marca en la sección Personal (/personal).
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { askText, notify } from "@/components/layout/Dialogs";
import { AppShell } from "@/components/layout/AppShell";
import { getAdminProducts } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth";
import { getDigitalMenu, sortCategories } from "@/lib/digital-menu";
import {
  ALL_DAYS,
  STAFF_MEAL_EVENT,
  WEEK_DAYS,
  getStaffMealConfig,
  saveStaffMealConfig,
  usersNotInList,
  type StaffMealConfig,
  type StaffPerson,
} from "@/lib/staff-meals";
import type { Product } from "@/data/products";

const newId = () => `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export default function CenaPersonalConfigPage() {
  const [config, setConfig] = useState<StaffMealConfig | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [dirty, setDirty] = useState(false);
  const [productSearch, setProductSearch] = useState("");

  useEffect(() => {
    const load = () => {
      setConfig(getStaffMealConfig());
      setDirty(false);
    };
    const loadProducts = () => setProducts(getAdminProducts().filter((p) => !p.notSoldAlone));
    load();
    loadProducts();
    window.addEventListener(STAFF_MEAL_EVENT, load);
    return () => window.removeEventListener(STAFF_MEAL_EVENT, load);
  }, []);

  const categories = useMemo(() => sortCategories(Array.from(new Set(products.map((p) => p.category))), getDigitalMenu().categoryOrder), [products]);

  if (!config) return null;
  const c = config;
  const change = (patch: Partial<StaffMealConfig>) => {
    setConfig({ ...c, ...patch });
    setDirty(true);
  };
  const changePerson = (id: string, patch: Partial<StaffPerson>) => change({ people: c.people.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const missingUsers = usersNotInList(c);

  async function addByName() {
    const name = (await askText("Nombre de la persona (sin usuario de B-POS)", { placeholder: "Ej. Juan", ok: "Agregar" }))?.trim();
    if (!name) return;
    change({ people: [...c.people, { id: newId(), name, days: [...ALL_DAYS], active: true }] });
  }

  function save() {
    const saved = saveStaffMealConfig(c, getCurrentUser()?.name);
    setConfig(saved);
    setDirty(false);
    notify("Configuración de la cena guardada.");
  }

  const visibleProducts = products.filter(
    (p) => (!c.categories.length || c.categories.includes(p.category)) && (!productSearch.trim() || p.name.toLowerCase().includes(productSearch.trim().toLowerCase()))
  );

  return (
    <RequireRole allow={["Admin", "Gerente"]}>
      <AppShell title="Cena del personal" subtitle="Quiénes tienen cena, qué días, qué pueden elegir y el tope. Se marca en la sección Personal.">
        <div className="max-w-4xl space-y-5 pb-28">
          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5 sm:p-6">
            <label className="flex items-center justify-between gap-4">
              <span>
                <span className="block text-xl font-black text-orange-500">🍽️ Cena del personal</span>
                <span className="mt-1 block text-sm text-zinc-400">
                  Cada quien marca su cena en <Link href="/personal" className="font-black text-orange-300 underline">Personal</Link>: va a las estaciones de cocina, descuenta inventario, sale un comprobante corto y te llega un aviso a la App del dueño. No cuenta como venta.
                </span>
              </span>
              <input type="checkbox" checked={c.enabled} onChange={(e) => change({ enabled: e.target.checked })} className="h-7 w-7 shrink-0 accent-orange-500" />
            </label>
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5 sm:p-6">
            <h2 className="text-lg font-black text-orange-500">👥 Quiénes tienen cena y qué días</h2>
            <p className="mt-1 text-sm text-zinc-400">Los días que no le tocan, su nombre sale en gris: &quot;No está en turno hoy&quot;. Una cena por persona al día.</p>
            <ul className="mt-4 space-y-3">
              {c.people.map((p) => (
                <li key={p.id} className={`rounded-2xl border p-3 ${p.active ? "border-zinc-800 bg-black" : "border-zinc-900 bg-black opacity-60"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={p.name}
                      onChange={(e) => changePerson(p.id, { name: e.target.value })}
                      className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 font-black text-white"
                    />
                    {p.userId ? <span className="rounded-lg bg-zinc-800 px-2 py-1 text-xs font-bold text-zinc-300">Usuario B-POS</span> : null}
                    <label className="flex items-center gap-1.5 text-xs font-bold text-zinc-300">
                      <input type="checkbox" checked={p.active} onChange={(e) => changePerson(p.id, { active: e.target.checked })} className="h-4 w-4 accent-orange-500" />
                      Tiene cena
                    </label>
                    <button type="button" onClick={() => change({ people: c.people.filter((x) => x.id !== p.id) })} className="rounded-xl border border-red-500/50 px-3 py-2 text-xs font-black text-red-300">
                      Quitar
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {ALL_DAYS.map((d) => {
                      const on = p.days.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => changePerson(p.id, { days: on ? p.days.filter((x) => x !== d) : [...p.days, d].sort() })}
                          className={`min-w-12 rounded-xl border px-2 py-1.5 text-xs font-black ${on ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-700 text-zinc-500"}`}
                        >
                          {WEEK_DAYS[d]}
                        </button>
                      );
                    })}
                  </div>
                </li>
              ))}
              {c.people.length === 0 && <li className="rounded-2xl border border-dashed border-zinc-800 p-4 text-sm text-zinc-500">Todavía no hay nadie. Agrégalos abajo.</li>}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              {missingUsers.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => change({ people: [...c.people, { id: newId(), name: u.name, userId: u.id, days: [...ALL_DAYS], active: true }] })}
                  className="rounded-xl border border-zinc-700 px-3 py-2 text-sm font-black text-zinc-200 hover:border-orange-500"
                >
                  + {u.name} <span className="text-xs text-zinc-500">({u.role})</span>
                </button>
              ))}
              <button type="button" onClick={() => void addByName()} className="rounded-xl border border-orange-500/60 px-3 py-2 text-sm font-black text-orange-300">
                + Otra persona
              </button>
            </div>
            <label className="mt-4 flex items-start gap-2 text-sm text-zinc-300">
              <input type="checkbox" checked={c.requireClockIn} onChange={(e) => change({ requireClockIn: e.target.checked })} className="mt-0.5 h-4 w-4 accent-orange-500" />
              <span>Solo pueden marcar si ya checaron entrada (para los que tienen usuario de B-POS; usa el checador).</span>
            </label>
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5 sm:p-6">
            <h2 className="text-lg font-black text-orange-500">📏 Tope por cena</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-zinc-300">
                Máximo de productos (0 = sin tope)
                <input type="number" min={0} value={c.maxItems} onChange={(e) => change({ maxItems: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} className="mt-1 w-full rounded-xl border border-zinc-800 bg-black px-3 py-2 font-black text-white" />
              </label>
              <label className="text-sm text-zinc-300">
                Máximo en precio de menú, $ (0 = sin tope)
                <input type="number" min={0} step={10} value={c.maxValue} onChange={(e) => change({ maxValue: Math.max(0, Number(e.target.value) || 0) })} className="mt-1 w-full rounded-xl border border-zinc-800 bg-black px-3 py-2 font-black text-white" />
              </label>
            </div>
            <label className="mt-3 block text-sm text-zinc-300">
              El día de la cena empieza a las
              <select value={c.dayStartHour} onChange={(e) => change({ dayStartHour: Number(e.target.value) })} className="ml-2 rounded-xl border border-zinc-800 bg-black px-3 py-2 font-black text-white">
                {Array.from({ length: 13 }, (_, h) => (
                  <option key={h} value={h}>
                    {h === 0 ? "12:00 a.m. (medianoche)" : h === 12 ? "12:00 p.m." : `${h}:00 a.m.`}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-zinc-500">Si cierras de madrugada: con 5 a.m., una cena a las 12:30 a.m. cuenta como del día anterior.</span>
            </label>
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5 sm:p-6">
            <h2 className="text-lg font-black text-orange-500">🍔 Qué pueden elegir</h2>
            <p className="mt-1 text-sm text-zinc-400">Sin categorías marcadas pueden elegir de todo el menú.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {categories.map((cat) => {
                const on = c.categories.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => change({ categories: on ? c.categories.filter((x) => x !== cat) : [...c.categories, cat] })}
                    className={`rounded-xl border px-3 py-2 text-sm font-black ${on ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-700 text-zinc-300"}`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
            <p className="mt-5 text-sm font-black text-zinc-300">Productos que no pueden elegir</p>
            <input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Buscar producto..." className="mt-2 w-full rounded-xl border border-zinc-800 bg-black px-3 py-2 text-sm text-white" />
            <ul className="bpos-scroll mt-2 max-h-72 space-y-1 overflow-y-auto pr-1">
              {visibleProducts.map((p) => {
                const blocked = c.blockedProducts.includes(Number(p.id));
                return (
                  <li key={p.id}>
                    <label className="flex items-center justify-between gap-3 rounded-xl px-2 py-1.5 text-sm hover:bg-zinc-900">
                      <span className={`min-w-0 break-words ${blocked ? "text-zinc-500 line-through" : "text-zinc-200"}`}>
                        {p.name} <span className="text-xs text-zinc-500">· {p.category}</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={blocked}
                        onChange={() => change({ blockedProducts: blocked ? c.blockedProducts.filter((x) => x !== Number(p.id)) : [...c.blockedProducts, Number(p.id)] })}
                        className="h-4 w-4 shrink-0 accent-red-500"
                      />
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-800 bg-black/95 p-3 md:left-auto md:right-6 md:bottom-6 md:rounded-2xl md:border">
          <button type="button" onClick={save} disabled={!dirty} className="w-full rounded-2xl bg-orange-500 px-6 py-3 font-black text-black disabled:opacity-40 md:w-auto">
            {dirty ? "Guardar cambios" : "✓ Guardado"}
          </button>
        </div>
      </AppShell>
    </RequireRole>
  );
}
