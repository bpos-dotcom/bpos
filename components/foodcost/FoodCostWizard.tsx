"use client";
/**
 * Food cost guiado: ventana con pasos para un platillo.
 *   1. ¿Cómo se llama?  2. ¿Qué lleva? (ingredientes y empaque)
 *   3. ¿Cuánto te cuesta cada cosa? (presentación y piezas)
 *   4. Tu food cost y a cuánto venderlo · ¿lo vendes en apps?
 *   5. Precio en DiDi, Uber y Rappi y la estrategia con descuento
 * Al terminar se guarda en B-POS (lib/foodcost-wizard.ts).
 */
import { useMemo, useState } from "react";
import { getAdminIngredients } from "@/lib/admin";
import { UNITS, unitFactor, type Unit } from "@/lib/units";
import {
  APP_STYLE,
  DELIVERY,
  appPricing,
  costLookup,
  defaultPlan,
  draftCost,
  itemUnitCost,
  saveDraft,
  savePlan,
  suggestedPrice,
  type DeliveryApp,
  type FoodCostPlan,
  type WizardDraft,
  type WizardItem,
} from "@/lib/foodcost-wizard";

const input = "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white placeholder:text-zinc-600";
const small = "rounded-xl border border-zinc-800 bg-black px-3 py-2 text-white";
const mxn = (n: number) => `$${(Number.isFinite(n) ? n : 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${(Number.isFinite(n) ? n : 0).toFixed(1)}%`;
const STEPS = ["Producto", "Qué lleva", "Costos", "Food cost", "Delivery"];

const emptyItem = (kind: WizardItem["kind"]): WizardItem => ({ ingredientId: null, name: "", kind, quantity: 0, unit: kind === "empaque" ? "pza" : "g", total: 0, packages: 1, perPackage: 0, packageUnit: kind === "empaque" ? "pza" : "kg" });

/** Apps encendidas agrupadas por comisión igual (si las tres cobran lo mismo, una sola explicación) */
function feeGroups(plan: FoodCostPlan): DeliveryApp[][] {
  const groups = new Map<string, DeliveryApp[]>();
  for (const app of DELIVERY.filter((a) => plan.apps[a].on)) {
    const key = `${plan.apps[app].commission}|${plan.apps[app].taxes}`;
    groups.set(key, [...(groups.get(key) || []), app]);
  }
  return [...groups.values()];
}

/** Logo simple de cada app (círculo con su color) */
export function AppBadge({ app }: { app: DeliveryApp }) {
  const s = APP_STYLE[app];
  return (
    <span className="inline-flex items-center gap-2 font-black">
      <span className="flex h-8 w-8 items-center justify-center rounded-full text-sm" style={{ background: s.color, color: s.text }}>
        {s.letter}
      </span>
      {app}
    </span>
  );
}

export function FoodCostWizard({ initial, initialPlan, onClose, onSaved }: { initial: WizardDraft; initialPlan?: FoodCostPlan; onClose: () => void; onSaved: () => void }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<WizardDraft>(initial);
  const [plan, setPlan] = useState<FoodCostPlan>(initialPlan || defaultPlan());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showFees, setShowFees] = useState(false);
  const ingredients = useMemo(() => getAdminIngredients(), []);
  const costAt = useMemo(() => costLookup(), []);
  const cost = draftCost(draft);
  const suggested = suggestedPrice(cost.total, plan.target);
  const price = draft.price || suggested;
  const foodCost = price > 0 ? (cost.total / price) * 100 : 0;

  const setItem = (index: number, patch: Partial<WizardItem>) => setDraft((d) => ({ ...d, items: d.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) }));
  const removeItem = (index: number) => setDraft((d) => ({ ...d, items: d.items.filter((_, i) => i !== index) }));
  const pickName = (index: number, name: string) => {
    const found = ingredients.find((i) => i.name.trim().toLowerCase() === name.trim().toLowerCase());
    setItem(index, found ? { name: found.name, ingredientId: Number(found.id), unit: found.unit as Unit, packageUnit: found.unit as Unit } : { name, ingredientId: null });
  };

  function next() {
    setError("");
    if (step === 0 && draft.name.trim().length < 2) return setError("Escribe el nombre del producto.");
    if (step === 1) {
      const items = draft.items.filter((i) => i.name.trim());
      if (!items.length) return setError("Agrega al menos un ingrediente o empaque.");
      if (items.some((i) => !(i.quantity > 0))) return setError("Escribe cuánto lleva cada cosa por porción.");
      setDraft((d) => ({ ...d, items }));
    }
    if (step === 2) {
      const missing = draft.items.filter((i) => !(itemUnitCost(i, (id) => costAt(id)) > 0));
      if (missing.length) return setError(`Falta el costo de: ${missing.map((i) => i.name).join(", ")}.`);
      const bad = draft.items.find((i) => i.total > 0 && unitFactor(i.packageUnit, i.unit) === null);
      if (bad) return setError(`${bad.name}: la presentación (${bad.packageUnit}) no se puede convertir a ${bad.unit}. Usa el mismo tipo de unidad.`);
      if (!draft.price) setDraft((d) => ({ ...d, price: suggestedPrice(draftCost(d).total, plan.target) }));
    }
    if (step === 3 && !(price > 0)) return setError("Escribe a cuánto lo vendes.");
    setStep((s) => s + 1);
  }

  function finish(delivery: boolean) {
    setSaving(true);
    try {
      const product = saveDraft({ ...draft, price });
      savePlan(product.id, { ...plan, delivery });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-2 sm:items-center sm:p-4">
      <div className="flex max-h-[95vh] w-full max-w-3xl flex-col rounded-3xl border border-orange-500/40 bg-zinc-950" role="dialog" aria-label="Food cost guiado">
        <div className="border-b border-zinc-800 p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-lg font-black">🧮 {draft.name.trim() || "Nuevo producto"}</p>
            <button onClick={onClose} className="rounded-xl border border-zinc-700 px-3 py-1 text-sm font-black text-zinc-400" aria-label="Cerrar">
              ✕
            </button>
          </div>
          <div className="mt-3 flex gap-1">
            {STEPS.map((s, i) => (
              <div key={s} className="flex-1">
                <div className={`h-1.5 rounded-full ${i <= step ? "bg-orange-500" : "bg-zinc-800"}`} />
                <p className={`mt-1 hidden text-[11px] font-bold sm:block ${i === step ? "text-orange-300" : "text-zinc-600"}`}>{s}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {step === 0 && (
            <div className="space-y-4">
              <p className="text-2xl font-black">¿Cómo se llama el producto?</p>
              <input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && next()} placeholder="Ej. Hamburguesa clásica" maxLength={60} className={input} />
              <label className="block text-sm font-bold text-zinc-400">
                Categoría (opcional)
                <input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="Ej. Hamburguesas" maxLength={40} className={`${input} mt-1`} />
              </label>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-2xl font-black">¿Qué ingredientes y qué empaque lleva?</p>
              <p className="text-sm text-zinc-400">Escribe cuánto lleva <b>una porción</b>. Incluye los desechables: caja, bolsa, vaso, servilletas, aderezos para llevar.</p>
              <datalist id="fc-ingredients">
                {ingredients.map((i) => (
                  <option key={i.id} value={i.name} />
                ))}
              </datalist>
              {draft.items.map((it, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-2xl border border-zinc-800 bg-black/40 p-3 sm:grid-cols-[auto_1fr_7rem_6.5rem_auto] sm:items-center">
                  <button onClick={() => setItem(i, { kind: it.kind === "empaque" ? "ingrediente" : "empaque" })} className={`col-span-2 rounded-xl px-3 py-2 text-xs font-black sm:col-span-1 ${it.kind === "empaque" ? "bg-sky-500/20 text-sky-200" : "bg-emerald-500/20 text-emerald-200"}`}>
                    {it.kind === "empaque" ? "🥡 Empaque" : "🥩 Ingrediente"}
                  </button>
                  <input list="fc-ingredients" value={it.name} onChange={(e) => pickName(i, e.target.value)} placeholder={it.kind === "empaque" ? "Ej. Caja para hamburguesa" : "Ej. Carne de res"} className={`${small} col-span-2 sm:col-span-1`} />
                  <input type="number" min={0} step="any" value={it.quantity || ""} onChange={(e) => setItem(i, { quantity: Number(e.target.value) })} placeholder="Cantidad" className={small} />
                  <select value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value as Unit })} className={small} aria-label="Unidad">
                    {UNITS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.value}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => removeItem(i)} className="text-sm font-black text-zinc-500 hover:text-red-400" aria-label="Quitar">
                    ✕
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setDraft({ ...draft, items: [...draft.items, emptyItem("ingrediente")] })} className="rounded-2xl border border-emerald-500/50 px-4 py-2 text-sm font-black text-emerald-200">
                  + Ingrediente
                </button>
                <button onClick={() => setDraft({ ...draft, items: [...draft.items, emptyItem("empaque")] })} className="rounded-2xl border border-sky-500/50 px-4 py-2 text-sm font-black text-sky-200">
                  + Empaque o desechable
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-2xl font-black">¿Cuánto te cuesta cada cosa?</p>
              <p className="text-sm text-zinc-400">Como viene cuando lo compras. Ej. &quot;1 bolsa de 5 kg en $450&quot; o &quot;1 paquete de 100 cajas en $280&quot;.</p>
              {draft.items.map((it, i) => {
                const known = it.ingredientId ? costAt(it.ingredientId) : 0;
                const unitCost = itemUnitCost(it, (id) => costAt(id));
                return (
                  <div key={i} className="rounded-2xl border border-zinc-800 bg-black/40 p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-black">
                        {it.kind === "empaque" ? "🥡" : "🥩"} {it.name} <span className="text-sm font-bold text-zinc-500">· lleva {it.quantity} {it.unit}</span>
                      </p>
                      {unitCost > 0 && <p className="text-sm font-black text-orange-300">{mxn(unitCost * it.quantity)} por porción</p>}
                    </div>
                    {known > 0 && !(it.total > 0) && <p className="mt-1 text-xs text-emerald-300">Ya tiene costo: {mxn(known)} por {it.unit}. Si cambió, escríbelo abajo.</p>}
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-zinc-400">Compro</span>
                      <input type="number" min={1} step="any" value={it.packages || ""} onChange={(e) => setItem(i, { packages: Number(e.target.value) })} className={`${small} w-20`} aria-label="Paquetes" />
                      <span className="text-zinc-400">paquete(s) de</span>
                      <input type="number" min={0} step="any" value={it.perPackage || ""} onChange={(e) => setItem(i, { perPackage: Number(e.target.value) })} placeholder="Contenido" className={`${small} w-28`} aria-label="Contenido de cada paquete" />
                      <select value={it.packageUnit} onChange={(e) => setItem(i, { packageUnit: e.target.value as Unit })} className={small} aria-label="Unidad de la presentación">
                        {UNITS.map((u) => (
                          <option key={u.value} value={u.value}>
                            {u.value}
                          </option>
                        ))}
                      </select>
                      <span className="text-zinc-400">y pago</span>
                      <input type="number" min={0} step="any" value={it.total || ""} onChange={(e) => setItem(i, { total: Number(e.target.value) })} placeholder="$ total" className={`${small} w-28`} aria-label="Cuánto pagas" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <p className="text-2xl font-black">Tu food cost</p>
              <div className="rounded-2xl border border-zinc-800 bg-black/40 p-4 text-sm">
                {cost.lines.map((l, i) => (
                  <p key={i} className="flex justify-between gap-3 text-zinc-300">
                    <span>
                      {l.item.name} <span className="text-zinc-500">({l.item.quantity} {l.item.unit})</span>
                    </span>
                    <b>{mxn(l.cost)}</b>
                  </p>
                ))}
                <p className="mt-2 flex justify-between border-t border-zinc-800 pt-2 text-base font-black">
                  <span>Te cuesta hacerlo</span>
                  <span className="text-orange-300">{mxn(cost.total)}</span>
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-bold text-zinc-400">
                  Food cost que buscas (%)
                  <input type="number" min={5} max={90} value={plan.target} onChange={(e) => setPlan({ ...plan, target: Number(e.target.value) || 30 })} className={`${input} mt-1`} />
                  <span className="mt-1 block text-xs font-normal text-zinc-500">Lo sano en restaurantes: entre 25% y 35%. Precio sugerido: {mxn(suggested)}.</span>
                </label>
                <label className="block text-sm font-bold text-zinc-400">
                  ¿A cuánto lo vendes en tu local?
                  <input type="number" min={0} step="any" value={draft.price || ""} onChange={(e) => setDraft({ ...draft, price: Number(e.target.value) })} placeholder={String(suggested)} className={`${input} mt-1`} />
                </label>
              </div>
              <div className={`rounded-2xl border p-4 text-center ${foodCost > plan.target + 5 ? "border-red-500/50 bg-red-500/10" : foodCost > plan.target ? "border-yellow-500/50 bg-yellow-500/10" : "border-emerald-500/50 bg-emerald-500/10"}`}>
                <p className="text-sm text-zinc-300">Vendiéndolo en {mxn(price)}, tu food cost es</p>
                <p className="text-5xl font-black">{pct(foodCost)}</p>
                <p className="mt-1 text-sm text-zinc-300">
                  Te deja {mxn(price - cost.total)} por pieza antes de gastos.{" "}
                  {foodCost > plan.target ? `Para llegar a ${plan.target}%, súbelo a ${mxn(suggested)} o baja el costo.` : "¡Va bien!"}
                </p>
              </div>
              <div className="rounded-2xl border border-zinc-800 p-4 text-center">
                <p className="text-lg font-black">¿Planeas venderlo en plataformas de delivery?</p>
                <p className="text-sm text-zinc-400">DiDi Food, Uber Eats o Rappi</p>
                <div className="mt-3 flex justify-center gap-3">
                  <button disabled={saving} onClick={() => { setPlan({ ...plan, delivery: true }); next(); }} className="rounded-2xl bg-orange-500 px-6 py-3 font-black text-black disabled:opacity-50">
                    Sí
                  </button>
                  <button disabled={saving} onClick={() => finish(false)} className="rounded-2xl border border-zinc-700 px-6 py-3 font-black text-zinc-200 disabled:opacity-50">
                    {saving ? "Guardando..." : "No, guardar"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <p className="text-2xl font-black">A cuánto venderlo en apps</p>
              <p className="text-sm text-zinc-400">
                Las apps se quedan con una comisión y retienen impuestos de lo que paga el cliente. Para recibir lo mismo que en tu local ({mxn(price)}), tienes que venderlo más caro.{" "}
                <button onClick={() => setShowFees(!showFees)} className="text-orange-400 underline">
                  {showFees ? "Ocultar comisiones" : "Ajustar comisiones"}
                </button>
              </p>
              {showFees && (
                <div className="grid gap-2 rounded-2xl border border-zinc-800 bg-black/40 p-3 sm:grid-cols-3">
                  {DELIVERY.map((app) => {
                    const fee = plan.apps[app];
                    const setFee = (patch: Partial<typeof fee>) => setPlan({ ...plan, apps: { ...plan.apps, [app]: { ...fee, ...patch } } });
                    return (
                      <div key={app} className="space-y-2 rounded-xl border border-zinc-800 p-3">
                        <label className="flex items-center justify-between gap-2">
                          <AppBadge app={app} />
                          <input type="checkbox" checked={fee.on} onChange={(e) => setFee({ on: e.target.checked })} className="h-5 w-5 accent-orange-500" aria-label={`Vender en ${app}`} />
                        </label>
                        <label className="block text-xs font-bold text-zinc-400">
                          Comisión (%)
                          <input type="number" min={0} max={90} value={fee.commission} onChange={(e) => setFee({ commission: Number(e.target.value) })} className={`${small} mt-1 w-full`} />
                        </label>
                        <label className="block text-xs font-bold text-zinc-400">
                          Impuestos sobre lo que queda (%)
                          <input type="number" min={0} max={90} value={fee.taxes} onChange={(e) => setFee({ taxes: Number(e.target.value) })} className={`${small} mt-1 w-full`} />
                        </label>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-3">
                {DELIVERY.filter((app) => plan.apps[app].on).map((app) => {
                  const p = appPricing(price, cost.total, plan.apps[app], plan.discount);
                  return (
                    <div key={app} className="rounded-2xl border border-zinc-800 bg-black/40 p-4 text-center">
                      <AppBadge app={app} />
                      <p className="mt-3 text-xs text-zinc-500">Véndelo en</p>
                      <p className="text-3xl font-black text-orange-300">{mxn(p.same)}</p>
                      <p className="mt-1 text-xs text-zinc-400">Recibes {mxn(p.receivedSame)} · te llega el {pct(p.net * 100)}</p>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-2xl border border-orange-500/40 bg-orange-500/5 p-4">
                <p className="font-black">🔥 Estrategia de marketing agresiva</p>
                <label className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-300">
                  Ofrecer
                  <input type="number" min={0} max={80} value={plan.discount} onChange={(e) => setPlan({ ...plan, discount: Number(e.target.value) || 0 })} className={`${small} w-20`} aria-label="Descuento" />% de descuento en la app
                </label>
                <div className="mt-3 space-y-3">
                  {feeGroups(plan).map((apps) => {
                    const p = appPricing(price, cost.total, plan.apps[apps[0]], plan.discount);
                    return (
                      <div key={apps.join()} className="rounded-xl border border-zinc-800 bg-black/40 p-3 text-sm">
                        <span className="flex flex-wrap gap-3">
                          {apps.map((app) => (
                            <AppBadge key={app} app={app} />
                          ))}
                        </span>
                        <p className="mt-2 text-zinc-200">
                          ✅ Publícalo en <b className="text-orange-300">{mxn(p.listed)}</b>, con {plan.discount}% de descuento el cliente paga <b>{mxn(p.same)}</b> y tú recibes <b className="text-emerald-300">{mxn(p.receivedSame)}</b> (lo mismo que en tu local, food cost {pct(p.foodCostSame)}).
                        </p>
                        <p className="mt-1 text-xs text-zinc-300">
                          ➖ Si lo publicas en {mxn(p.listedToLocal)} para que con el descuento quede en {mxn(price)}, recibes {mxn(p.receivedToLocal)}: food cost {pct(p.foodCostToLocal)}.
                        </p>
                        <p className="mt-1 text-xs text-yellow-200">
                          ⚠️ Si lo publicas en tu precio de local ({mxn(price)}) con {plan.discount}% de descuento, el cliente paga {mxn(p.localWithDiscount)} y solo recibes {mxn(p.receivedLocalDiscount)}: tu food cost sube a {pct(p.foodCostLocalDiscount)}.
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          {error && <p className="mt-4 rounded-2xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-zinc-800 p-4">
          <button disabled={step === 0 || saving} onClick={() => { setError(""); setStep((s) => s - 1); }} className="rounded-2xl border border-zinc-700 px-5 py-3 font-black text-zinc-300 disabled:opacity-30">
            ← Atrás
          </button>
          {step < 3 && (
            <button onClick={next} className="rounded-2xl bg-orange-500 px-6 py-3 font-black text-black">
              Siguiente →
            </button>
          )}
          {step === 4 && (
            <button disabled={saving} onClick={() => finish(true)} className="rounded-2xl bg-orange-500 px-6 py-3 font-black text-black disabled:opacity-50">
              {saving ? "Guardando..." : "Guardar y ver mi panel"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
