"use client";
/**
 * Configuración → Menú digital → Promociones: el negocio crea promociones
 * que se aplican solas en el carrito (2x1, % de descuento, $ de descuento,
 * envío gratis) y elige para quién son (todos, clientes nuevos o el club).
 */
import { useState } from "react";
import type { Product } from "@/data/products";
import { getLoyalty } from "@/lib/loyalty";
import {
  PROMO_AUDIENCES,
  PROMO_KINDS,
  newPromotion,
  promoLabel,
  promoState,
  promotionError,
  type PromoAudience,
  type PromoKind,
  type Promotion,
} from "@/lib/promotions";

const input = "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white";
const label = "block text-sm font-bold text-zinc-300";

const STATE_COLOR: Record<ReturnType<typeof promoState>, string> = {
  activa: "bg-emerald-500/15 text-emerald-300",
  pausada: "bg-zinc-800 text-zinc-400",
  "por empezar": "bg-sky-500/15 text-sky-300",
  vencida: "bg-red-500/15 text-red-300",
};

export function PromotionsEditor({ promotions, products, delivery, onChange }: { promotions: Promotion[]; products: Product[]; delivery: boolean; onChange: (list: Promotion[]) => void }) {
  const [draft, setDraft] = useState<Promotion | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const categories = Array.from(new Set(products.map((p) => p.category || "Otros"))).sort((a, b) => a.localeCompare(b));
  const clubOn = getLoyalty().enabled;

  function save() {
    if (!draft) return;
    const problem = promotionError(draft);
    if (problem) return setError(problem);
    const exists = promotions.some((p) => p.id === draft.id);
    onChange(exists ? promotions.map((p) => (p.id === draft.id ? draft : p)) : [...promotions, draft]);
    setDraft(null);
    setError("");
  }

  const set = (patch: Partial<Promotion>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const found = search.trim() ? products.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 30) : [];

  return (
    <div data-promotions-editor>
      {promotions.length === 0 && !draft && <p className="mt-4 text-sm text-zinc-500">Aún no tienes promociones.</p>}
      <div className="mt-4 grid min-w-0 grid-cols-1 gap-3">
        {promotions.map((p) => {
          const state = promoState(p);
          return (
            <div key={p.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-black p-4">
              <div>
                <p className="font-black">🎉 {promoLabel(p)}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {PROMO_KINDS.find((k) => k.kind === p.kind)?.label} · {PROMO_AUDIENCES.find((a) => a.audience === p.audience)?.label}
                  {p.from || p.until ? ` · ${p.from || "hoy"} a ${p.until || "sin fin"}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-black ${STATE_COLOR[state]}`}>{state}</span>
                <button type="button" onClick={() => onChange(promotions.map((x) => (x.id === p.id ? { ...x, active: !x.active } : x)))} className="rounded-xl border border-zinc-700 px-3 py-2 text-xs font-black">
                  {p.active ? "Pausar" : "Activar"}
                </button>
                <button type="button" onClick={() => { setDraft(p); setError(""); }} className="rounded-xl border border-zinc-700 px-3 py-2 text-xs font-black">
                  Editar
                </button>
                <button type="button" onClick={() => window.confirm(`¿Borrar la promoción "${promoLabel(p)}"?`) && onChange(promotions.filter((x) => x.id !== p.id))} className="rounded-xl border border-red-900 px-3 py-2 text-xs font-black text-red-300">
                  Borrar
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {!draft && (
        <button type="button" onClick={() => { setDraft(newPromotion()); setError(""); }} className="mt-4 rounded-2xl bg-orange-500 px-5 py-3 font-black text-black">
          + Nueva promoción
        </button>
      )}

      {draft && (
        <div className="mt-4 grid gap-4 rounded-2xl border border-orange-500/50 bg-black p-4" data-promo-form>
          <div>
            <p className={label}>Tipo de promoción</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {PROMO_KINDS.map((k) => (
                <button
                  key={k.kind}
                  type="button"
                  onClick={() => set({ kind: k.kind as PromoKind })}
                  className={`rounded-2xl border p-3 text-left ${draft.kind === k.kind ? "border-orange-500 bg-orange-500/10" : "border-zinc-800"}`}
                >
                  <span className="font-black">{k.label}</span>
                  <span className="mt-1 block text-xs text-zinc-500">{k.hint}</span>
                </button>
              ))}
            </div>
            {draft.kind === "freeShipping" && !delivery && <p className="mt-2 text-xs font-bold text-yellow-200">Aún no tienes servicio a domicilio activado: actívalo arriba en Pedidos para que sirva.</p>}
          </div>

          {(draft.kind === "percent" || draft.kind === "amount") && (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={label}>
                {draft.kind === "percent" ? "¿Qué porcentaje?" : "¿Cuántos pesos?"}
                <input type="number" min={0} max={draft.kind === "percent" ? 100 : undefined} value={draft.value || ""} onChange={(e) => set({ value: Number(e.target.value) })} className={`${input} mt-1`} placeholder={draft.kind === "percent" ? "10" : "50"} />
              </label>
              {draft.kind === "percent" && (
                <label className={label}>
                  Descuento máximo en pesos (opcional)
                  <input type="number" min={0} value={draft.maxDiscount || ""} onChange={(e) => set({ maxDiscount: Number(e.target.value) })} className={`${input} mt-1`} placeholder="Sin tope" />
                </label>
              )}
            </div>
          )}

          {draft.kind === "2x1" && (
            <div>
              <p className={label}>¿En qué productos? (si no eliges nada, en todo el menú)</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {categories.map((c) => (
                  <button key={c} type="button" onClick={() => set({ categories: toggle(draft.categories, c) })} className={`rounded-full border px-3 py-1.5 text-xs font-black ${draft.categories.includes(c) ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-700 text-zinc-300"}`}>
                    {c}
                  </button>
                ))}
              </div>
              <input value={search} onChange={(e) => setSearch(e.target.value)} className={`${input} mt-3`} placeholder="Buscar un producto…" />
              {found.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {found.map((p) => (
                    <button key={p.id} type="button" onClick={() => set({ productIds: toggle(draft.productIds, Number(p.id)) })} className={`rounded-full border px-3 py-1.5 text-xs font-black ${draft.productIds.includes(Number(p.id)) ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-700 text-zinc-300"}`}>
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
              {draft.productIds.length > 0 && (
                <p className="mt-2 text-xs text-zinc-400">
                  Productos: {draft.productIds.map((id) => products.find((p) => Number(p.id) === id)?.name || `#${id}`).join(", ")}
                </p>
              )}
              <p className="mt-2 text-xs text-zinc-500">De cada dos piezas que entran en la promoción, la más barata va gratis.</p>
            </div>
          )}

          <div>
            <p className={label}>¿Para quién es?</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {PROMO_AUDIENCES.map((a) => (
                <button
                  key={a.audience}
                  type="button"
                  onClick={() => set({ audience: a.audience as PromoAudience })}
                  className={`rounded-2xl border p-3 text-left ${draft.audience === a.audience ? "border-orange-500 bg-orange-500/10" : "border-zinc-800"}`}
                >
                  <span className="font-black">{a.label}</span>
                  <span className="mt-1 block text-xs text-zinc-500">{a.hint}</span>
                </button>
              ))}
            </div>
            {draft.audience === "club" && !clubOn && <p className="mt-2 text-xs font-bold text-yellow-200">Tu club no está activo: actívalo en Configuración → Club para que sirva.</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className={label}>
              Compra mínima (opcional)
              <input type="number" min={0} value={draft.minPurchase || ""} onChange={(e) => set({ minPurchase: Number(e.target.value) })} className={`${input} mt-1`} placeholder="Cualquiera" />
            </label>
            <label className={label}>
              Empieza (opcional)
              <input type="date" value={draft.from} onChange={(e) => set({ from: e.target.value })} className={`${input} mt-1`} />
            </label>
            <label className={label}>
              Termina (opcional)
              <input type="date" value={draft.until} onChange={(e) => set({ until: e.target.value })} className={`${input} mt-1`} />
            </label>
          </div>

          <label className={label}>
            Nombre que ve el cliente (opcional)
            <input value={draft.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} className={`${input} mt-1`} placeholder={promoLabel({ ...draft, name: "" })} />
          </label>

          <p className="rounded-xl bg-zinc-900 p-3 text-sm">
            Tus clientes verán: <b className="text-orange-400">🎉 {promoLabel(draft)}</b>
          </p>
          {error && <p className="text-sm font-bold text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={save} className="rounded-2xl bg-orange-500 px-5 py-3 font-black text-black">
              Guardar promoción
            </button>
            <button type="button" onClick={() => { setDraft(null); setError(""); }} className="rounded-2xl border border-zinc-700 px-5 py-3 font-black">
              Cancelar
            </button>
          </div>
        </div>
      )}
      <p className="mt-4 text-xs text-zinc-500">
        Se aplican solas en el carrito del menú digital, sin que el cliente escriba nada. No se juntan entre sí ni con un cupón: se usa la que más le ahorra. Al aceptar el pedido, B-POS revisa que de verdad le toque.
      </p>
    </div>
  );
}
