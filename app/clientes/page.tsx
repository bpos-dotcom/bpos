"use client";
/**
 * Clientes (Entrega 4): se arman solos con las ventas que traen nombre o
 * teléfono, con su historial, cuánto han gastado y qué piden. Pestaña de
 * Cupones: códigos de descuento para el POS y el menú digital.
 */
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { getBusinessSettings } from "@/lib/business-settings";
import { CUSTOMERS_EVENT, SEGMENTS, buildCustomers, customerWhatsapp, saveCustomerNote, type Customer, type Segment } from "@/lib/customers";
import { COUPONS_EVENT, couponLabel, couponState, deleteCoupon, getCoupons, newCoupon, normalizeCode, saveCoupon, type Coupon } from "@/lib/coupons";
import { getDigitalMenu } from "@/lib/digital-menu";
import { PUSH_SERVER } from "@/lib/push/rules";
import { loadReportSources } from "@/lib/reports";

const card = "rounded-3xl border border-zinc-800 bg-zinc-950 p-5";
const input = "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white";
const label = "block text-sm font-bold text-zinc-300";
const money = (n: number) => `$${Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const date = (iso: string) => new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "2-digit" });
const daysAgo = (iso: string) => {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  return d <= 0 ? "hoy" : d === 1 ? "ayer" : `hace ${d} días`;
};

// ------------------------------------------------------------ clientes

function CustomerDetail({ customer, coupons, onClose }: { customer: Customer; coupons: Coupon[]; onClose: () => void }) {
  const [notes, setNotes] = useState(customer.notes);
  const [couponId, setCouponId] = useState("");
  const business = getBusinessSettings().businessName || "nosotros";
  const slug = getDigitalMenu().slug;
  const menuLink = slug ? `${PUSH_SERVER}/m/${slug}` : "";
  const usable = coupons.filter((c) => couponState(c) === "activo");
  const coupon = usable.find((c) => c.id === couponId);
  const first = customer.name.split(" ")[0];
  const message = coupon
    ? `¡Hola ${first}! 🧡 En ${business} te tenemos un regalo: usa el cupón *${coupon.code}* y obtén ${couponLabel(coupon)}.${menuLink ? `\nPide aquí: ${menuLink}` : ""}`
    : `¡Hola ${first}! Te saludamos de ${business}. ${menuLink ? `Te dejamos nuestro menú: ${menuLink}` : ""}`;
  const wa = customerWhatsapp(customer, message);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur" onClick={onClose}>
      <aside className="h-full w-full max-w-lg overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black">{customer.name}</h2>
            <p className="text-sm text-zinc-400">{customer.phone || "Sin teléfono"}{customer.address ? ` · ${customer.address}` : ""}</p>
            <span className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-black ${SEGMENTS[customer.segment].cls}`}>{SEGMENTS[customer.segment].label}</span>
          </div>
          <button onClick={onClose} className="rounded-xl border border-zinc-800 px-3 py-2 font-black">✕</button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-2xl bg-black p-3"><p className="text-xs text-zinc-500">Pedidos</p><p className="text-xl font-black">{customer.orders}</p></div>
          <div className="rounded-2xl bg-black p-3"><p className="text-xs text-zinc-500">Ha gastado</p><p className="text-xl font-black text-orange-400">{money(customer.spent)}</p></div>
          <div className="rounded-2xl bg-black p-3"><p className="text-xs text-zinc-500">Ticket prom.</p><p className="text-xl font-black">{money(customer.average)}</p></div>
        </div>
        <p className="mt-3 text-sm text-zinc-400">
          Cliente desde {date(customer.firstAt)} · último pedido {daysAgo(customer.lastAt)} · {customer.channels.join(", ")}
          {customer.coupons ? ` · usó ${customer.coupons} cupón(es)` : ""}
        </p>
        {customer.favorites.length > 0 && (
          <p className="mt-2 text-sm">
            <b>Lo que más pide:</b> {customer.favorites.map((f) => `${f.name} (${f.quantity})`).join(", ")}
          </p>
        )}

        {customer.phone && (
          <div className="mt-4 rounded-2xl border border-zinc-800 p-4">
            <p className="font-black">📲 Escribirle por WhatsApp</p>
            <select value={couponId} onChange={(e) => setCouponId(e.target.value)} className={`${input} mt-2 text-sm`}>
              <option value="">Sin cupón (solo saludar y mandar el menú)</option>
              {usable.map((c) => (
                <option key={c.id} value={c.id}>
                  Regalarle {c.code} · {couponLabel(c)}
                </option>
              ))}
            </select>
            {wa && (
              <a href={wa} target="_blank" rel="noreferrer" className="mt-2 block rounded-2xl bg-[#25d366] py-3 text-center font-black text-white">
                Abrir WhatsApp
              </a>
            )}
          </div>
        )}

        <label className={`${label} mt-4`}>
          Notas (alergias, preferencias, cumpleaños...)
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={3} className={`${input} mt-1`} />
        </label>
        <button onClick={() => saveCustomerNote(customer.key, customer.name, notes)} disabled={notes === customer.notes} className="mt-2 rounded-2xl bg-orange-500 px-4 py-2 font-black text-black disabled:opacity-40">
          Guardar nota
        </button>

        <h3 className="mt-6 font-black">Historial ({customer.visits.length})</h3>
        <div className="mt-2 space-y-2">
          {customer.visits.slice(0, 100).map((v, i) => (
            <div key={`${v.id}-${i}`} className="rounded-2xl bg-black p-3 text-sm">
              <div className="flex justify-between gap-2">
                <span className="font-black">{date(v.createdAt)} · {v.channel}</span>
                <span className="font-black text-orange-400">{money(v.total)}</span>
              </div>
              <p className="text-xs text-zinc-400">{v.items}</p>
              {v.coupon && <p className="text-xs text-emerald-400">Cupón {v.coupon}</p>}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function CustomersTab({ coupons }: { coupons: Coupon[] }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<Segment | "todos">("todos");
  const [sort, setSort] = useState<"reciente" | "gasto" | "pedidos">("reciente");
  const [open, setOpen] = useState<Customer | null>(null);

  useEffect(() => {
    const load = () => setCustomers(buildCustomers(loadReportSources().orders));
    load();
    window.addEventListener("bpos:orders-updated", load);
    window.addEventListener(CUSTOMERS_EVENT, load);
    return () => {
      window.removeEventListener("bpos:orders-updated", load);
      window.removeEventListener(CUSTOMERS_EVENT, load);
    };
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: customers.length };
    customers.forEach((x) => (c[x.segment] = (c[x.segment] || 0) + 1));
    return c;
  }, [customers]);

  const q = query.trim().toLowerCase();
  const shown = customers
    .filter((c) => (segment === "todos" || c.segment === segment) && (!q || c.name.toLowerCase().includes(q) || c.phone.includes(q.replace(/\D/g, "") || "~")))
    .sort((a, b) => (sort === "gasto" ? b.spent - a.spent : sort === "pedidos" ? b.orders - a.orders : b.lastAt.localeCompare(a.lastAt)));
  const total = customers.reduce((s, c) => s + c.spent, 0);
  const repeat = customers.filter((c) => c.orders >= 2).length;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-4">
        <div className={card}><p className="text-sm text-zinc-400">Clientes</p><p className="text-4xl font-black">{customers.length}</p></div>
        <div className={card}><p className="text-sm text-zinc-400">Regresan (2+ pedidos)</p><p className="text-4xl font-black">{customers.length ? Math.round((repeat / customers.length) * 100) : 0}%</p></div>
        <div className={card}><p className="text-sm text-zinc-400">Gasto promedio por cliente</p><p className="text-4xl font-black">{money(customers.length ? total / customers.length : 0)}</p></div>
        <div className={card}><p className="text-sm text-zinc-400">Dormidos para recuperar</p><p className="text-4xl font-black text-red-400">{counts.dormido || 0}</p></div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["todos", "vip", "frecuente", "nuevo", "dormido", "ocasional"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSegment(s)}
            title={s === "todos" ? "" : SEGMENTS[s].hint}
            className={`rounded-2xl border px-4 py-2 text-sm font-black ${segment === s ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-800 text-zinc-300"}`}
          >
            {s === "todos" ? "Todos" : SEGMENTS[s].label} ({counts[s] || 0})
          </button>
        ))}
      </div>
      {segment !== "todos" && <p className="text-sm text-zinc-400">{SEGMENTS[segment].hint}</p>}

      <div className="flex flex-wrap gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔎 Buscar por nombre o teléfono" className={`${input} min-w-0 flex-1`} />
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="rounded-2xl border border-zinc-800 bg-black px-4 py-3">
          <option value="reciente">Más recientes</option>
          <option value="gasto">Los que más gastan</option>
          <option value="pedidos">Más pedidos</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-3xl border border-zinc-800">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-zinc-950 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3 text-right">Pedidos</th>
              <th className="px-4 py-3 text-right">Ha gastado</th>
              <th className="px-4 py-3">Último pedido</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 500).map((c) => (
              <tr key={c.key} onClick={() => setOpen(c)} className="cursor-pointer border-t border-zinc-900 hover:bg-zinc-900">
                <td className="px-4 py-3">
                  <p className="font-black">{c.name}</p>
                  <p className="text-xs text-zinc-500">{c.phone || "sin teléfono"}</p>
                </td>
                <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-black ${SEGMENTS[c.segment].cls}`}>{SEGMENTS[c.segment].label}</span></td>
                <td className="px-4 py-3 text-right font-black">{c.orders}</td>
                <td className="px-4 py-3 text-right font-black text-orange-400">{money(c.spent)}</td>
                <td className="px-4 py-3 text-zinc-400">{daysAgo(c.lastAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && (
          <p className="p-8 text-center text-sm text-zinc-500">
            {customers.length ? "Nadie coincide con la búsqueda." : "Aún no hay clientes. Se agregan solos con cada venta que lleve nombre o teléfono (domicilio, menú digital o mostrador)."}
          </p>
        )}
      </div>
      {open && <CustomerDetail customer={open} coupons={coupons} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ------------------------------------------------------------ cupones

const STATE_CLS: Record<ReturnType<typeof couponState>, string> = {
  activo: "bg-emerald-500/20 text-emerald-300",
  pausado: "bg-zinc-800 text-zinc-400",
  "por empezar": "bg-sky-500/20 text-sky-300",
  vencido: "bg-red-500/20 text-red-300",
  agotado: "bg-amber-500/20 text-amber-300",
};

function CouponForm({ initial, onDone }: { initial: Coupon; onDone: () => void }) {
  const [c, setC] = useState(initial);
  const [error, setError] = useState("");
  const set = (patch: Partial<Coupon>) => setC((x) => ({ ...x, ...patch }));
  const num = (v: string) => Math.max(0, Number(v) || 0);

  function save() {
    try {
      saveCoupon(c);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    }
  }

  return (
    <div className={`${card} border-orange-500/60`}>
      <h3 className="text-lg font-black">{initial.code ? `Editar ${initial.code}` : "Nuevo cupón"}</h3>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className={label}>
          Código
          <input value={c.code} onChange={(e) => set({ code: normalizeCode(e.target.value) })} placeholder="BURGER10" className={`${input} mt-1 font-mono uppercase`} />
        </label>
        <label className={label}>
          Tipo
          <select value={c.kind} onChange={(e) => set({ kind: e.target.value as Coupon["kind"] })} className={`${input} mt-1`}>
            <option value="percent">% de descuento</option>
            <option value="amount">$ pesos de descuento</option>
          </select>
        </label>
        <label className={label}>
          {c.kind === "percent" ? "Porcentaje %" : "Pesos $"}
          <input type="number" min={0} value={c.value || ""} onChange={(e) => set({ value: num(e.target.value) })} className={`${input} mt-1`} />
        </label>
        <label className={label}>
          Compra mínima $ (0 = cualquiera)
          <input type="number" min={0} value={c.minPurchase || ""} onChange={(e) => set({ minPurchase: num(e.target.value) })} className={`${input} mt-1`} />
        </label>
        {c.kind === "percent" && (
          <label className={label}>
            Descuento máximo $ (0 = sin tope)
            <input type="number" min={0} value={c.maxDiscount || ""} onChange={(e) => set({ maxDiscount: num(e.target.value) })} className={`${input} mt-1`} />
          </label>
        )}
        <label className={label}>
          Usos en total (0 = sin límite)
          <input type="number" min={0} value={c.maxUses || ""} onChange={(e) => set({ maxUses: Math.round(num(e.target.value)) })} className={`${input} mt-1`} />
        </label>
        <label className={label}>
          Desde (opcional)
          <input type="date" value={c.from} onChange={(e) => set({ from: e.target.value })} className={`${input} mt-1`} />
        </label>
        <label className={label}>
          Hasta (opcional)
          <input type="date" value={c.until} onChange={(e) => set({ until: e.target.value })} className={`${input} mt-1`} />
        </label>
        <label className={label}>
          Nota interna
          <input value={c.note} onChange={(e) => set({ note: e.target.value.slice(0, 80) })} placeholder="Campaña de Facebook" className={`${input} mt-1`} />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-sm font-bold">
        <label className="flex items-center gap-2"><input type="checkbox" checked={c.pos} onChange={(e) => set({ pos: e.target.checked })} className="h-5 w-5 accent-orange-500" /> Sirve en el POS (mostrador)</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={c.online} onChange={(e) => set({ online: e.target.checked })} className="h-5 w-5 accent-orange-500" /> Sirve en el menú digital</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={c.active} onChange={(e) => set({ active: e.target.checked })} className="h-5 w-5 accent-orange-500" /> Activo</label>
      </div>
      {c.value > 0 && <p className="mt-3 text-sm text-zinc-400">El cliente verá: <b className="text-white">{couponLabel(c)}</b></p>}
      {error && <p className="mt-2 text-sm font-bold text-red-300">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button onClick={save} className="rounded-2xl bg-orange-500 px-5 py-3 font-black text-black">Guardar cupón</button>
        <button onClick={onDone} className="rounded-2xl border border-zinc-700 px-5 py-3 font-black">Cancelar</button>
      </div>
    </div>
  );
}

function CouponsTab({ coupons }: { coupons: Coupon[] }) {
  const [editing, setEditing] = useState<Coupon | null>(null);
  const sorted = [...coupons].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="space-y-5">
      <div className={card}>
        <p className="text-sm text-zinc-400">
          Crea un código (ej. <b>BURGER10</b>) y compártelo. El cliente lo escribe al pedir en tu menú digital, o el cajero lo aplica al cobrar en el POS. Cada venta
          con cupón cuenta un uso; puedes ver quién lo usó en Clientes.
        </p>
        {!editing && (
          <button onClick={() => setEditing(newCoupon())} className="mt-3 rounded-2xl bg-orange-500 px-5 py-3 font-black text-black">
            + Nuevo cupón
          </button>
        )}
      </div>
      {editing && <CouponForm key={editing.id} initial={editing} onDone={() => setEditing(null)} />}
      <div className="grid gap-4 lg:grid-cols-2">
        {sorted.map((c) => {
          const state = couponState(c);
          return (
            <div key={c.id} className={card}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-2xl font-black tracking-wider">{c.code}</p>
                  <p className="text-sm text-zinc-300">{couponLabel(c)}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-black ${STATE_CLS[state]}`}>{state}</span>
              </div>
              <p className="mt-2 text-xs text-zinc-400">
                Usado {c.uses} {c.maxUses ? `de ${c.maxUses}` : ""} vez(es) · {[c.pos ? "POS" : "", c.online ? "Menú digital" : ""].filter(Boolean).join(" y ") || "ningún lado"}
                {c.from || c.until ? ` · ${c.from ? `desde ${c.from}` : ""} ${c.until ? `hasta ${c.until}` : ""}` : ""}
                {c.note ? ` · ${c.note}` : ""}
              </p>
              {c.maxUses > 0 && (
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.min(100, (c.uses / c.maxUses) * 100)}%` }} />
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => setEditing(c)} className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-black">Editar</button>
                <button onClick={() => saveCoupon({ ...c, active: !c.active })} className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-black">
                  {c.active ? "Pausar" : "Activar"}
                </button>
                <button
                  onClick={() => {
                    if (confirm(`¿Borrar el cupón ${c.code}? Las ventas que lo usaron no cambian.`)) deleteCoupon(c.id);
                  }}
                  className="rounded-xl border border-red-500/50 px-3 py-1.5 text-xs font-black text-red-300"
                >
                  Borrar
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {coupons.length === 0 && !editing && <p className="rounded-3xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">Todavía no tienes cupones.</p>}
    </div>
  );
}

export default function ClientesPage() {
  const [tab, setTab] = useState<"clientes" | "cupones">("clientes");
  const [coupons, setCoupons] = useState<Coupon[]>([]);

  useEffect(() => {
    const load = () => setCoupons(getCoupons());
    load();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pestaña pedida en la liga (?tab=cupones)
    if (new URLSearchParams(window.location.search).get("tab") === "cupones") setTab("cupones");
    window.addEventListener(COUPONS_EVENT, load);
    return () => window.removeEventListener(COUPONS_EVENT, load);
  }, []);

  return (
    <AppShell title="Clientes" subtitle="Tus clientes se agregan solos con cada venta que trae nombre o teléfono. Y tus cupones de descuento.">
      <div className="mb-5 flex gap-2">
        {(
          [
            ["clientes", "👥 Clientes"],
            ["cupones", `🎟️ Cupones (${coupons.length})`],
          ] as const
        ).map(([key, text]) => (
          <button key={key} onClick={() => setTab(key)} className={`rounded-2xl border px-5 py-3 font-black ${tab === key ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-800 text-zinc-300"}`}>
            {text}
          </button>
        ))}
      </div>
      {tab === "clientes" ? <CustomersTab coupons={coupons} /> : <CouponsTab coupons={coupons} />}
    </AppShell>
  );
}
