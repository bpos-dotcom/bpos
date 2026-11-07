"use client";
/**
 * B-POS Servicios → Food cost guiado: el panel con los platillos que ya
 * pasaron por el asistente (costo, precio, food cost y precio en cada app
 * de delivery) y el botón para dar de alta otro (components/foodcost).
 * También sirve en B-POS completo: usa los mismos productos y costos.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import RequirePermission from "@/components/auth/RequirePermission";
import { AppShell } from "@/components/layout/AppShell";
import { AppBadge, FoodCostWizard } from "@/components/foodcost/FoodCostWizard";
import type { Product } from "@/data/products";
import { getAdminProducts } from "@/lib/admin";
import { useServicesState } from "@/lib/services-client";
import { DELIVERY, FOODCOST_PLANS_EVENT, appPricing, currentCost, draftFromProduct, getPlans, type FoodCostPlan, type WizardDraft } from "@/lib/foodcost-wizard";

const mxn = (n: number) => `$${(Number.isFinite(n) ? n : 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${(Number.isFinite(n) ? n : 0).toFixed(1)}%`;
const blank: WizardDraft = { productId: null, name: "", category: "", price: 0, items: [{ ingredientId: null, name: "", kind: "ingrediente", quantity: 0, unit: "g", total: 0, packages: 1, perPackage: 0, packageUnit: "kg" }] };

export default function FoodCostServicePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [plans, setPlans] = useState<Record<string, FoodCostPlan>>({});
  const [editing, setEditing] = useState<{ draft: WizardDraft; plan?: FoodCostPlan } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const servicesOnly = useServicesState()?.kind === "servicios";

  useEffect(() => {
    const load = () => {
      setProducts(getAdminProducts());
      setPlans(getPlans());
    };
    load();
    window.addEventListener(FOODCOST_PLANS_EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(FOODCOST_PLANS_EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, []);

  // Los del asistente primero; "ver todos" muestra también los demás productos con receta
  const rows = products
    .filter((p) => !p.notSoldAlone)
    .map((p) => ({ p, plan: plans[String(p.id)], cost: currentCost(p) }))
    .filter((r) => r.plan || (showAll && !r.cost.noRecipe))
    .sort((a, b) => Number(Boolean(b.plan)) - Number(Boolean(a.plan)) || a.p.name.localeCompare(b.p.name, "es"));
  const withPlan = rows.filter((r) => r.plan).length;

  return (
    <RequirePermission permission="products.manage">
      <AppShell title="Food cost" subtitle="Cuánto te cuesta cada platillo y a cuánto venderlo en tu local y en las apps de delivery.">
        <div className="max-w-6xl space-y-5">
          <section className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-orange-500/40 bg-zinc-950 p-5">
            <div>
              <p className="text-xl font-black">🧮 Calcula el food cost de un platillo</p>
              <p className="mt-1 text-sm text-zinc-400">Paso a paso: qué lleva, cuánto te cuesta, a cuánto venderlo y su precio en DiDi, Uber y Rappi.</p>
            </div>
            <button onClick={() => setEditing({ draft: { ...blank, items: [...blank.items] } })} className="rounded-2xl bg-orange-500 px-6 py-3 font-black text-black">
              + Nuevo platillo
            </button>
          </section>

          {rows.length === 0 ? (
            <section className="rounded-3xl border border-dashed border-zinc-800 p-10 text-center text-zinc-400">
              Todavía no calculas ningún platillo. Toca <b>+ Nuevo platillo</b> y en un par de minutos sabes cuánto te cuesta y a cuánto venderlo.
            </section>
          ) : (
            <section className="grid gap-4 lg:grid-cols-2">
              {rows.map(({ p, plan, cost }) => {
                const price = Number(p.price) || 0;
                const fc = price > 0 ? (cost.total / price) * 100 : 0;
                const target = plan?.target ?? 30;
                const apps = plan?.delivery ? DELIVERY.filter((a) => plan.apps[a]?.on) : [];
                return (
                  <article key={p.id} className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-black">{p.name}</p>
                        <p className="text-xs text-zinc-500">{p.category}</p>
                      </div>
                      <button onClick={() => setEditing({ draft: draftFromProduct(p), plan })} className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-black text-zinc-300 hover:border-orange-500">
                        Editar
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-2xl bg-black p-3">
                        <p className="text-[11px] text-zinc-500">Te cuesta</p>
                        <p className="font-black text-orange-300">{mxn(cost.total)}</p>
                      </div>
                      <div className="rounded-2xl bg-black p-3">
                        <p className="text-[11px] text-zinc-500">Lo vendes en</p>
                        <p className="font-black">{mxn(price)}</p>
                      </div>
                      <div className="rounded-2xl bg-black p-3">
                        <p className="text-[11px] text-zinc-500">Food cost</p>
                        <p className={`font-black ${fc > target + 5 ? "text-red-400" : fc > target ? "text-yellow-300" : "text-emerald-400"}`}>{pct(fc)}</p>
                      </div>
                    </div>
                    {cost.missing.length > 0 && <p className="mt-2 text-xs text-yellow-300">Sin costo: {cost.missing.join(", ")}.</p>}
                    {apps.length > 0 && (
                      <div className="mt-3 space-y-1.5 border-t border-zinc-800 pt-3 text-sm">
                        {apps.map((app) => {
                          const r = appPricing(price, cost.total, plan!.apps[app], plan!.discount);
                          return (
                            <div key={app} className="flex flex-wrap items-center justify-between gap-2">
                              <AppBadge app={app} />
                              <span className="text-right text-zinc-300">
                                <b className="text-orange-300">{mxn(r.same)}</b>
                                <span className="block text-[11px] text-zinc-500">
                                  o publicado en {mxn(r.listed)} con {plan!.discount}% de descuento
                                </span>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {!plan && <p className="mt-2 text-xs text-zinc-500">Calculado con su receta de B-POS. Toca Editar para revisarlo paso a paso.</p>}
                  </article>
                );
              })}
            </section>
          )}

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2 text-zinc-400">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="h-4 w-4 accent-orange-500" />
              Ver también los demás productos con receta ({withPlan} hechos con el asistente)
            </label>
            {!servicesOnly && (
              <Link href="/configuracion/food-cost" className="text-orange-400 underline">
                Food cost con ventas y gastos fijos
              </Link>
            )}
          </div>
        </div>
        {editing && (
          <FoodCostWizard
            initial={editing.draft}
            initialPlan={editing.plan}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              setProducts(getAdminProducts());
              setPlans(getPlans());
            }}
          />
        )}
      </AppShell>
    </RequirePermission>
  );
}
