"use client";
/**
 * Menú digital público: bpos.com.mx/m/<liga>(?mesa=4)
 *
 * Diseño editable desde Configuración → Menú digital: barra de arriba,
 * portada, categorías con foto, combo destacado, los más pedidos (ventas
 * reales de 30 días), el menú completo, "Pide donde quieras" (WhatsApp, DiDi,
 * Uber, Rappi) y banner final. El cliente arma su pedido sin iniciar sesión
 * y ve cómo va (Recibido → Preparando → Listo). Paga al recoger o al
 * recibir; con transferencia ve los datos del banco y manda el desglose y su
 * comprobante por WhatsApp al negocio.
 */
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Product } from "@/data/products";
import { OWN_OPTIONS, buildSelection, extrasPrice, extraCount, isAutoGroup, modifierProblem, optionName } from "@/lib/compound";
import {
  isAvailableOnline,
  isOpenNow,
  mapsLink,
  normalizeDigitalMenu,
  onlineGroups,
  orderWhatsappText,
  whatsappNumber,
  type DigitalMenuSettings,
  type OnlineOrderData,
  type OnlineOrderLine,
  type OnlineOrderType,
} from "@/lib/digital-menu";
import { scheduleLabel } from "@/lib/sale-schedule";
import { getSupabase } from "@/lib/supabase/client";
import { AddressMap } from "@/components/menu/AddressMap";

type PublicMenu = {
  slug: string;
  business: { name: string; logo: string; color: string };
  branch: string;
  menu: DigitalMenuSettings;
  products: Product[];
  top: { id: number; qty: number }[];
};

type Placed = { id: string; token: string; folio: string };

type OrderStatus = {
  folio: string;
  status: "nuevo" | "aceptando" | "aceptado" | "rechazado" | "listo" | "entregado";
  eta_minutes: number | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
  data: OnlineOrderData;
  branch: string;
};

type Picks = Record<string, string[]>;

const money = (n: number) => `$${n.toFixed(2)}`;
const price = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
const waLink = (number: string, text: string) => `https://wa.me/${number}?text=${encodeURIComponent(text)}`;

export default function PublicMenuPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [data, setData] = useState<PublicMenu | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [table, setTable] = useState("");
  const [placed, setPlaced] = useState<Placed | null>(null);

  const load = useCallback(async () => {
    try {
      const { data: res, error: e } = await getSupabase().rpc("bpos_menu_public", { p_slug: slug });
      if (e) throw new Error(e.message);
      if (!res) {
        setData(null);
        return;
      }
      const r = res as PublicMenu;
      setData({
        ...r,
        menu: normalizeDigitalMenu(r.menu),
        products: (r.products || []).map((p) => ({ ...p, id: Number(p.id), price: Number(p.price) })),
        top: (r.top || []).map((t) => ({ id: Number(t.id), qty: Number(t.qty) })),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el menú.");
    }
  }, [slug]);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- datos de la liga: solo después de montar
    setTable((q.get("mesa") || "").replace(/[^0-9a-zA-Z-]/g, "").slice(0, 6));
    const id = q.get("pedido");
    const token = q.get("t");
    if (id && token) setPlaced({ id, token, folio: "" });
    void load();
    // Agotados y cambios del negocio se ven sin recargar
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  if (placed) {
    return (
      <OrderTracking
        slug={slug}
        placed={placed}
        data={data || null}
        onBack={() => {
          setPlaced(null);
          window.history.replaceState(null, "", `/m/${slug}${table ? `?mesa=${table}` : ""}`);
        }}
      />
    );
  }
  if (data === undefined) {
    return <Shell><p className="py-24 text-center text-zinc-500">{error || "Cargando menú..."}</p></Shell>;
  }
  if (data === null || !data.menu.enabled) {
    return (
      <Shell>
        <div className="py-24 text-center">
          <p className="text-5xl">🍽️</p>
          <h1 className="mt-4 text-2xl font-black">Este menú no está disponible</h1>
          <p className="mt-2 text-zinc-500">Revisa la liga o pregúntale al negocio.</p>
        </div>
      </Shell>
    );
  }
  return (
    <Menu
      data={data}
      table={table}
      onPlaced={(p) => {
        setPlaced(p);
        window.history.replaceState(null, "", `/m/${slug}?pedido=${p.id}&t=${p.token}`);
      }}
    />
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen w-full bg-[#fff8f1] text-zinc-900">{children}</div>;
}

/** Foto del producto, o su emoji en un fondo suave si no tiene. */
function Photo({ product, className = "", big = false }: { product: Pick<Product, "image" | "emoji" | "name">; className?: string; big?: boolean }) {
  if (product.image) {
    // eslint-disable-next-line @next/next/no-img-element -- fotos del negocio en la nube
    return <img src={product.image} alt={product.name} loading="lazy" className={`object-cover ${className}`} />;
  }
  return <div className={`flex items-center justify-center bg-orange-50 ${big ? "text-7xl" : "text-5xl"} ${className}`}>{product.emoji || "🍽️"}</div>;
}

// ------------------------------------------------------------ menú

type CartLine = OnlineOrderLine & { key: string };

function Menu({ data, table, onPlaced }: { data: PublicMenu; table: string; onPlaced: (p: Placed) => void }) {
  const { business, menu } = data;
  const design = menu.design;
  const color = business.color || "#f97316";
  const [now] = useState(() => new Date());
  const [category, setCategory] = useState("Todos");
  const [search, setSearch] = useState("");
  const [choosing, setChoosing] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [checkout, setCheckout] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const open = isOpenNow(menu, now);
  const canOrder = menu.acceptOrders && open;
  const visible = useMemo(
    () => data.products.filter((p) => !p.notSoldAlone && isAvailableOnline(menu, p, now) && !onlineGroups(p, data.products, menu, now).blocked),
    [data.products, menu, now]
  );
  const byId = useMemo(() => new Map(visible.map((p) => [Number(p.id), p])), [visible]);
  const categories = useMemo(() => Array.from(new Set(visible.map((p) => p.category || "Otros"))), [visible]);
  const shown = visible.filter(
    (p) => (category === "Todos" || (p.category || "Otros") === category) && p.name.toLowerCase().includes(search.trim().toLowerCase())
  );
  // Los más pedidos: ventas reales del mes; sin ventas todavía, los primeros del menú
  const top = useMemo(() => {
    const sold = data.top.map((t) => ({ product: byId.get(t.id), qty: t.qty })).filter((t): t is { product: Product; qty: number } => Boolean(t.product));
    return (sold.length ? sold : visible.map((product) => ({ product, qty: 0 }))).slice(0, design.top.count);
  }, [data.top, byId, visible, design.top.count]);
  const featured = design.featured.productId !== null ? byId.get(design.featured.productId) : undefined;
  const total = cart.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const count = cart.reduce((s, l) => s + l.quantity, 0);
  const wa = whatsappNumber(menu.whatsapp);
  const channels = design.channels;
  const links = [
    channels.whatsapp.on && wa ? { key: "wa", label: "Pedir por WhatsApp", href: `https://wa.me/${wa}`, cls: "bg-[#25d366] text-white" } : null,
    channels.didi.on && channels.didi.url ? { key: "didi", label: "DiDi Food", href: channels.didi.url, cls: "bg-[#fc4c02] text-white" } : null,
    channels.uber.on && channels.uber.url ? { key: "uber", label: "Uber Eats", href: channels.uber.url, cls: "bg-black text-white" } : null,
    channels.rappi.on && channels.rappi.url ? { key: "rappi", label: "Rappi", href: channels.rappi.url, cls: "bg-[#ff441f] text-white" } : null,
  ].filter((l): l is { key: string; label: string; href: string; cls: string } => Boolean(l));

  function goToMenu(cat = "Todos") {
    setCategory(cat);
    menuRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function pick(product: Product) {
    if (!canOrder) return;
    setChoosing(product);
  }

  function add(product: Product, picks: Picks, comment: string) {
    const selection = buildSelection(product, data.products, { [OWN_OPTIONS]: picks });
    const unitPrice = Number(product.price) + extrasPrice(selection.modifiers, selection.parts);
    const summary = [
      ...(selection.parts || []).map((p) => `${p.quantity > 1 ? `${p.quantity} ` : ""}${p.name}`),
      ...(selection.modifiers || []).filter((m) => !m.extra).map((m) => m.name),
    ].join(" · ");
    const key = `${product.id}|${JSON.stringify(picks)}|${comment}`;
    setCart((c) => {
      const found = c.find((l) => l.key === key);
      if (found) return c.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
      return [...c, { key, productId: product.id, name: product.name, quantity: 1, unitPrice, picks: { [OWN_OPTIONS]: picks }, summary, ...(comment ? { comment } : {}) }];
    });
  }

  const hoursText = menu.hours ? scheduleLabel(menu.hours) : "";
  const plusBtn = (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl font-black text-white shadow" style={{ background: color }}>
      +
    </span>
  );

  return (
    <Shell>
      {design.topBar.on && (design.topBar.text || design.topBar.city || hoursText) && (
        <div className="px-4 py-2 text-xs font-semibold text-white" style={{ background: color }}>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
            <span>{design.topBar.text}</span>
            <span className="flex flex-wrap gap-3">
              {design.topBar.city && <span>📍 {design.topBar.city}</span>}
              {hoursText && <span>🕚 {hoursText}</span>}
            </span>
          </div>
        </div>
      )}

      <header className="sticky top-0 z-20 border-b border-orange-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- logo del negocio */}
          <img src={business.logo || "/bpos-logo.png"} alt="" className="h-11 w-11 rounded-xl object-contain" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-black uppercase tracking-tight">{business.name}</p>
            <p className="truncate text-xs text-zinc-500">
              {data.branch}
              {table && <b className="ml-1 text-zinc-800">· Mesa {table}</b>}
            </p>
          </div>
          <span className={`hidden rounded-full px-3 py-1 text-xs font-black sm:inline ${canOrder ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-600"}`}>
            {canOrder ? "Abierto" : menu.acceptOrders ? "Cerrado" : "Solo menú"}
          </span>
          {count > 0 && (
            <button onClick={() => setCheckout(true)} className="rounded-full px-4 py-2 text-sm font-black text-white" style={{ background: color }}>
              🛒 {count} · {money(total)}
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-32">
        {menu.notice && <p className="mt-4 rounded-2xl px-4 py-3 text-sm font-bold text-white" style={{ background: color }}>{menu.notice}</p>}
        {!canOrder && menu.acceptOrders && (
          <p className="mt-4 rounded-2xl bg-zinc-200 px-4 py-3 text-sm text-zinc-700">
            Ahora no estamos recibiendo pedidos{hoursText ? ` · Horario: ${hoursText}` : ""}. Puedes ver el menú.
          </p>
        )}

        {/* Portada */}
        {design.hero.on && (design.hero.title || design.hero.highlight || design.hero.image) && (
          <section className="mt-4 grid items-center gap-6 overflow-hidden rounded-3xl bg-gradient-to-br from-white to-orange-50 p-6 md:grid-cols-2 md:p-10">
            <div>
              {design.hero.eyebrow && <p className="text-xs font-black uppercase tracking-[0.3em]" style={{ color }}>{design.hero.eyebrow}</p>}
              <h1 className="mt-2 text-4xl font-black uppercase leading-none tracking-tight md:text-6xl">
                {design.hero.title}
                {design.hero.highlight && <span className="block" style={{ color }}>{design.hero.highlight}</span>}
              </h1>
              {design.hero.text && <p className="mt-4 max-w-md text-zinc-600">{design.hero.text}</p>}
              {design.hero.badges.some(Boolean) && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {design.hero.badges.filter(Boolean).map((b) => (
                    <span key={b} className="rounded-full border px-3 py-1 text-xs font-bold" style={{ borderColor: color, color }}>
                      {b}
                    </span>
                  ))}
                </div>
              )}
              <button onClick={() => goToMenu()} className="mt-6 rounded-full px-7 py-3 font-black text-white shadow-lg" style={{ background: color }}>
                {design.hero.button || "Ver menú"} →
              </button>
            </div>
            {design.hero.image && (
              // eslint-disable-next-line @next/next/no-img-element -- portada del negocio
              <img src={design.hero.image} alt="" className="aspect-[4/3] w-full rounded-3xl object-cover shadow-xl" />
            )}
          </section>
        )}

        {/* Categorías */}
        {categories.length > 1 && (
          <div className="mt-6 flex gap-3 overflow-x-auto pb-2">
            {categories.map((c) => {
              const sample = visible.find((p) => (p.category || "Otros") === c && p.image) || visible.find((p) => (p.category || "Otros") === c)!;
              return (
                <button key={c} onClick={() => goToMenu(c)} className="w-28 shrink-0 overflow-hidden rounded-2xl border border-orange-100 bg-white text-center shadow-sm hover:shadow-md">
                  <Photo product={sample} className="h-20 w-full" />
                  <span className="block px-2 py-2 text-xs font-black">{c}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Combo destacado */}
        {design.featured.on && featured && (
          <section className="mt-6 grid items-center gap-4 overflow-hidden rounded-3xl bg-zinc-950 p-6 text-white md:grid-cols-2 md:p-8">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.3em]" style={{ color }}>{design.featured.eyebrow}</p>
              <h2 className="mt-2 text-3xl font-black">{featured.name}</h2>
              <p className="mt-2 text-sm text-zinc-300">{design.featured.text || featured.description}</p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-white px-5 py-2 text-xl font-black" style={{ color }}>{price(Number(featured.price))} MXN</span>
                {canOrder && (
                  <button onClick={() => pick(featured)} className="rounded-full px-5 py-2.5 font-black text-white" style={{ background: color }}>
                    Pedir ahora →
                  </button>
                )}
              </div>
            </div>
            <div className="relative">
              {design.featured.image ? (
                // eslint-disable-next-line @next/next/no-img-element -- banner del negocio
                <img src={design.featured.image} alt="" className="aspect-[16/10] w-full rounded-2xl object-cover" />
              ) : (
                <Photo product={featured} big className="aspect-[16/10] w-full rounded-2xl" />
              )}
              {design.featured.badge && (
                <span className="absolute right-3 top-3 rotate-6 rounded-full px-4 py-3 text-center text-xs font-black uppercase leading-tight text-white shadow-lg" style={{ background: color }}>
                  {design.featured.badge}
                </span>
              )}
            </div>
          </section>
        )}

        {/* Los más pedidos */}
        {design.top.on && top.length > 0 && (
          <section className="mt-8">
            <h2 className="text-2xl font-black">🔥 {design.top.title}</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
              {top.map(({ product, qty }, i) => (
                <button key={product.id} onClick={() => pick(product)} className="relative flex flex-col overflow-hidden rounded-2xl border border-orange-100 bg-white text-left shadow-sm hover:shadow-md">
                  {qty > 0 && <span className="absolute left-2 top-2 z-10 rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] font-black text-white">#{i + 1}</span>}
                  <Photo product={product} className="aspect-square w-full" />
                  <span className="flex flex-1 flex-col p-3">
                    <span className="font-black leading-tight">{product.name}</span>
                    {product.description && <span className="mt-1 line-clamp-2 text-xs text-zinc-500">{product.description}</span>}
                    <span className="mt-auto flex items-center justify-between pt-2">
                      <span className="font-black" style={{ color }}>{price(Number(product.price))} <small className="text-[10px]">MXN</small></span>
                      {canOrder && plusBtn}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Menú completo */}
        <section ref={menuRef} className="mt-8 scroll-mt-24">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-2xl font-black">Menú</h2>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar un platillo..." className="w-full max-w-xs rounded-full border border-orange-100 bg-white px-4 py-2 text-sm outline-none focus:border-orange-300" />
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {["Todos", ...categories].map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className="shrink-0 rounded-full border px-4 py-1.5 text-sm font-bold"
                style={category === c ? { background: color, borderColor: color, color: "#fff" } : { borderColor: "#fed7aa", background: "#fff" }}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((p) => (
              <button key={p.id} disabled={!canOrder} onClick={() => pick(p)} className="flex items-center gap-3 rounded-2xl border border-orange-100 bg-white p-3 text-left shadow-sm transition hover:shadow-md disabled:cursor-default">
                <Photo product={p} className="h-20 w-20 shrink-0 rounded-xl" />
                <span className="min-w-0 flex-1">
                  <span className="block font-black leading-tight">{p.name}</span>
                  {p.description && <span className="mt-0.5 line-clamp-2 block text-xs text-zinc-500">{p.description}</span>}
                  <span className="mt-1 block text-sm font-black" style={{ color }}>{price(Number(p.price))}</span>
                </span>
                {canOrder && plusBtn}
              </button>
            ))}
          </div>
          {shown.length === 0 && <p className="py-12 text-center text-zinc-500">No hay platillos en esta sección.</p>}
        </section>

        {/* Pide donde quieras */}
        {channels.on && links.length > 0 && (
          <section className="mt-10 grid items-center gap-4 rounded-3xl border border-orange-100 bg-white p-5 md:grid-cols-[auto_1fr_auto]">
            {channels.image && (
              // eslint-disable-next-line @next/next/no-img-element -- imagen del negocio
              <img src={channels.image} alt="" className="h-24 w-24 object-contain" />
            )}
            <div>
              <h2 className="text-2xl font-black leading-tight">
                {channels.title} <span style={{ color }}>{channels.highlight}</span>
              </h2>
              {channels.text && <p className="text-sm text-zinc-500">{channels.text}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {links.map((l) => (
                <a key={l.key} href={l.href} target="_blank" rel="noreferrer" className={`rounded-xl px-4 py-3 text-sm font-black ${l.cls}`}>
                  {l.label} →
                </a>
              ))}
            </div>
          </section>
        )}

        {/* Banner final */}
        {design.banner.on && (design.banner.image || design.banner.title) && (
          <section className="relative mt-6 overflow-hidden rounded-3xl" style={{ background: `linear-gradient(90deg, #ffe2c4, ${color})` }}>
            {design.banner.image && (
              // eslint-disable-next-line @next/next/no-img-element -- banner del negocio
              <img src={design.banner.image} alt="" className="absolute inset-0 h-full w-full object-cover opacity-90" />
            )}
            <div className="relative flex min-h-32 flex-wrap items-center justify-between gap-3 p-6">
              <h2 className="text-3xl font-black uppercase leading-none text-zinc-900 drop-shadow-sm">
                {design.banner.title}
                {design.banner.highlight && <span className="block text-white drop-shadow">{design.banner.highlight}</span>}
              </h2>
              {design.banner.side && <p className="max-w-[12rem] -rotate-3 text-right text-lg font-black uppercase text-zinc-900">{design.banner.side}</p>}
            </div>
          </section>
        )}

        <p className="mt-10 text-center text-xs text-zinc-400">Menú digital por bpos.com.mx · pedidos sin comisión</p>
      </main>

      {count > 0 && !checkout && (
        <div className="fixed inset-x-0 bottom-0 z-30 p-4" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
          <button onClick={() => setCheckout(true)} className="mx-auto flex w-full max-w-3xl items-center justify-between rounded-2xl px-5 py-4 text-lg font-black text-white shadow-xl" style={{ background: color }}>
            <span>Ver mi pedido ({count})</span>
            <span>{money(total)}</span>
          </button>
        </div>
      )}

      {choosing && (
        <ChoiceSheet
          product={choosing}
          catalog={data.products}
          menu={menu}
          color={color}
          onClose={() => setChoosing(null)}
          onAdd={(picks, comment) => {
            add(choosing, picks, comment);
            setChoosing(null);
          }}
        />
      )}

      {checkout && (
        <Checkout
          data={data}
          color={color}
          table={table}
          cart={cart}
          setCart={setCart}
          onClose={() => setCheckout(false)}
          onPlaced={onPlaced}
        />
      )}
    </Shell>
  );
}

// ------------------------------------------------------------ opciones

function ChoiceSheet({
  product,
  catalog,
  menu,
  color,
  onClose,
  onAdd,
}: {
  product: Product;
  catalog: Product[];
  menu: DigitalMenuSettings;
  color: string;
  onClose: () => void;
  onAdd: (picks: Picks, comment: string) => void;
}) {
  const { groups } = useMemo(() => onlineGroups(product, catalog, menu), [product, catalog, menu]);
  const [picks, setPicks] = useState<Picks>(() => Object.fromEntries(groups.filter(isAutoGroup).map((g) => [g.key, Array(g.min).fill(g.options[0].key)])));
  const [comment, setComment] = useState("");
  const problem = modifierProblem(groups, picks);
  const p = { ...product, modifierGroups: groups };
  const total = Number(product.price) + extrasPrice(buildSelection(p, catalog, { [OWN_OPTIONS]: picks }).modifiers);

  function toggle(groupKey: string, optionKey: string, max: number, min: number) {
    setPicks((cur) => {
      const list = cur[groupKey] || [];
      if (max === 1 && min <= 1) return { ...cur, [groupKey]: list[0] === optionKey && min === 0 ? [] : [optionKey] };
      if (list.includes(optionKey)) return { ...cur, [groupKey]: list.filter((k) => k !== optionKey) };
      if (max > 0 && list.length >= max) return cur;
      return { ...cur, [groupKey]: [...list, optionKey] };
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        {product.image && <Photo product={product} className="aspect-[16/10] w-full" />}
        <div className="p-5">
          <div className="flex items-start gap-3">
            {!product.image && <span className="text-5xl">{product.emoji || "🍽️"}</span>}
            <div className="flex-1">
              <h2 className="text-xl font-black">{product.name}</h2>
              {product.description && <p className="text-sm text-zinc-500">{product.description}</p>}
              <p className="font-black" style={{ color }}>{money(Number(product.price))}</p>
            </div>
            <button onClick={onClose} className="rounded-full bg-zinc-100 px-3 py-1 text-lg" aria-label="Cerrar">✕</button>
          </div>

          {groups.filter((g) => !isAutoGroup(g)).map((g) => {
            const chosen = picks[g.key] || [];
            const extra = extraCount(g, chosen.length);
            return (
              <div key={g.key} className="mt-5">
                <p className="font-black">
                  {g.name}
                  <span className="ml-2 text-xs font-bold text-zinc-500">
                    {g.min > 0 ? `Obligatorio · elige ${g.min}` : "Opcional"}
                    {g.max > 1 ? ` · máximo ${g.max}` : ""}
                    {Number(g.extraPrice) > 0 ? ` · ${g.included} incluida${g.included === 1 ? "" : "s"}, extra ${money(Number(g.extraPrice))}` : ""}
                  </span>
                </p>
                <div className="mt-2 grid gap-2">
                  {g.options.map((o) => {
                    const on = chosen.includes(o.key);
                    return (
                      <button
                        key={o.key}
                        onClick={() => toggle(g.key, o.key, g.max, g.min)}
                        className="flex items-center justify-between rounded-xl border px-4 py-3 text-left"
                        style={on ? { borderColor: color, background: `${color}14` } : { borderColor: "#e4e4e7" }}
                      >
                        <span className="font-bold">{optionName(o, catalog)}</span>
                        <span className="text-lg" style={{ color: on ? color : "#a1a1aa" }}>{on ? "●" : "○"}</span>
                      </button>
                    );
                  })}
                </div>
                {extra > 0 && Number(g.extraPrice) > 0 && <p className="mt-1 text-xs text-zinc-500">+{money(extra * Number(g.extraPrice))} por {extra} extra</p>}
              </div>
            );
          })}

          <label className="mt-5 block text-sm font-bold">
            Indicaciones (opcional)
            <input value={comment} maxLength={140} onChange={(e) => setComment(e.target.value)} placeholder="Ej. sin cebolla" className="mt-1 w-full rounded-xl border border-zinc-200 px-4 py-3" />
          </label>

          {problem && <p className="mt-3 text-sm font-bold text-red-600">{problem.charAt(0).toUpperCase() + problem.slice(1)}</p>}
          <button
            disabled={Boolean(problem)}
            onClick={() => onAdd(picks, comment.trim())}
            className="mt-4 w-full rounded-2xl py-4 text-lg font-black text-white disabled:opacity-40"
            style={{ background: color }}
          >
            Agregar · {money(total)}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ enviar

function Checkout({
  data,
  color,
  table,
  cart,
  setCart,
  onClose,
  onPlaced,
}: {
  data: PublicMenu;
  color: string;
  table: string;
  cart: CartLine[];
  setCart: React.Dispatch<React.SetStateAction<CartLine[]>>;
  onClose: () => void;
  onPlaced: (p: Placed) => void;
}) {
  const { menu, slug } = data;
  const wa = whatsappNumber(menu.whatsapp);
  // Recoger y domicilio se muestran siempre; lo que el negocio no ofrece sale como "No disponible"
  const offered: Record<OnlineOrderType, boolean> = { Recoger: menu.pickup, Domicilio: menu.delivery, Mesa: Boolean(table) };
  const [type, setType] = useState<OnlineOrderType>(table ? "Mesa" : menu.pickup || !menu.delivery ? "Recoger" : "Domicilio");
  // Formas de pago de ese tipo de pedido; transferencia solo con CLABE y WhatsApp del negocio
  const payments = menu.paymentsByType[type].filter((p) => p !== "Transferencia" || (wa && menu.bank.clabe.length === 18));
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [reference, setReference] = useState("");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [chosenPayment, setPayment] = useState<OnlineOrderData["payment"]>(payments[0] || "Efectivo");
  // Si cambia el tipo de pedido y esa forma de pago no aplica, se toma la primera permitida
  const payment = payments.includes(chosenPayment) ? chosenPayment : payments[0];
  const [cashWith, setCashWith] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("bpos_menu_customer") || "{}");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- datos guardados del cliente
      if (saved.name) setName(saved.name);
      if (saved.phone) setPhone(saved.phone);
      if (saved.address) setAddress(saved.address);
    } catch {}
  }, []);

  const subtotal = cart.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const fee = type === "Domicilio" ? menu.deliveryFee : 0;
  const total = subtotal + fee;
  const belowMin = menu.minOrder > 0 && subtotal < menu.minOrder;

  function qty(key: string, delta: number) {
    setCart((c) => c.map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l)).filter((l) => l.quantity > 0));
  }

  async function send() {
    setError("");
    if (!name.trim()) return setError("Escribe tu nombre.");
    if (type !== "Mesa" && phone.replace(/\D/g, "").length < 10) return setError("Escribe tu teléfono a 10 dígitos para avisarte.");
    if (type === "Domicilio" && !address.trim()) return setError("Escribe la dirección de entrega.");
    if (belowMin) return setError(`El pedido mínimo es de ${money(menu.minOrder)}.`);
    if (!offered[type]) return setError(type === "Domicilio" ? "Por ahora no tenemos servicio a domicilio. Elige para recoger." : "Por ahora no tenemos pedidos para recoger.");
    if (!payment) return setError("El negocio no tiene formas de pago para este tipo de pedido.");
    const order: OnlineOrderData = {
      type,
      ...(type === "Mesa" ? { table } : {}),
      customer: {
        name: name.trim().slice(0, 60),
        phone: phone.replace(/\D/g, "").slice(0, 15),
        address: address.trim().slice(0, 200),
        reference: reference.trim().slice(0, 120),
        ...(type === "Domicilio" && location ? { location } : {}),
      },
      payment,
      ...(payment === "Efectivo" && Number(cashWith) > 0 ? { cashWith: Number(cashWith) } : {}),
      note: note.trim().slice(0, 200),
      lines: cart.map(({ productId, name: n, quantity, unitPrice, picks, summary, comment }) => ({ productId, name: n, quantity, unitPrice, picks, summary, ...(comment ? { comment } : {}) })),
      subtotal,
      deliveryFee: fee,
      total,
    };
    setSending(true);
    try {
      const { data: placed, error: e } = await getSupabase().rpc("bpos_menu_place_order", { p_slug: slug, p_order: order });
      if (e) throw new Error(e.message);
      try {
        localStorage.setItem("bpos_menu_customer", JSON.stringify({ name: order.customer.name, phone: order.customer.phone, address: order.customer.address }));
      } catch {}
      setCart([]);
      const p = placed as Placed;
      // Transferencia: se abre WhatsApp con el desglose (si el navegador lo bloquea, queda el botón en el seguimiento)
      if (payment === "Transferencia" && wa) window.open(waLink(wa, orderWhatsappText(data.business.name, p.folio, order)), "_blank");
      onPlaced(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar el pedido. Intenta de nuevo.");
    } finally {
      setSending(false);
    }
  }

  const field = "mt-1 w-full rounded-xl border border-zinc-200 px-4 py-3";
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-black">Tu pedido</h2>
          <button onClick={onClose} className="rounded-full bg-zinc-100 px-3 py-1 text-lg" aria-label="Cerrar">✕</button>
        </div>
        <div className="mt-3 divide-y divide-zinc-100">
          {cart.map((l) => (
            <div key={l.key} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-black">{l.name}</p>
                {l.summary && <p className="text-xs text-zinc-500">{l.summary}</p>}
                {l.comment && <p className="text-xs italic text-zinc-500">“{l.comment}”</p>}
                <p className="text-sm font-bold" style={{ color }}>{money(l.unitPrice * l.quantity)}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => qty(l.key, -1)} className="h-8 w-8 rounded-full bg-zinc-100 font-black" aria-label="Quitar uno">−</button>
                <span className="w-5 text-center font-black">{l.quantity}</span>
                <button onClick={() => qty(l.key, 1)} className="h-8 w-8 rounded-full bg-zinc-100 font-black" aria-label="Agregar uno">+</button>
              </div>
            </div>
          ))}
        </div>
        {cart.length === 0 && <p className="py-6 text-center text-zinc-500">Tu pedido está vacío.</p>}

        {!table && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            {(["Recoger", "Domicilio"] as const).map((t) => (
              <button
                key={t}
                disabled={!offered[t]}
                onClick={() => setType(t)}
                className="rounded-xl border py-3 font-black disabled:cursor-not-allowed disabled:opacity-40"
                style={type === t ? { background: color, borderColor: color, color: "#fff" } : { borderColor: "#e4e4e7" }}
              >
                {t === "Recoger" ? "🛍️ Paso a recoger" : "🛵 A domicilio"}
                {!offered[t] && <span className="block text-[10px] font-bold">No disponible</span>}
              </button>
            ))}
          </div>
        )}
        {type === "Mesa" && <p className="mt-4 rounded-xl bg-zinc-100 px-4 py-3 font-bold">🍽️ Pedido para la mesa {table}</p>}

        <label className="mt-4 block text-sm font-bold">
          Tu nombre
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} name="name" autoComplete="name" className={field} />
        </label>
        {type !== "Mesa" && (
          <label className="mt-3 block text-sm font-bold">
            Teléfono (WhatsApp)
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={15} name="tel" autoComplete="tel-national" className={field} />
          </label>
        )}
        {type === "Domicilio" && (
          <>
            <p className="mt-3 text-sm font-bold">¿Dónde te lo llevamos?</p>
            <AddressMap
              location={location}
              color={color}
              onChange={(place, found) => {
                setLocation(place);
                if (found) setAddress(found);
              }}
            />
            <label className="mt-3 block text-sm font-bold">
              Dirección de entrega (revisa calle y número)
              <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} name="street-address" autoComplete="street-address" className={field} />
            </label>
            <label className="mt-3 block text-sm font-bold">
              Referencias (opcional)
              <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} placeholder="Casa azul, junto a la tienda" className={field} />
            </label>
          </>
        )}

        {payments.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-bold">Pagas {type === "Domicilio" ? "al recibir" : type === "Mesa" ? "en la mesa" : "al recoger"} con:</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {payments.map((p) => (
                <button key={p} onClick={() => setPayment(p)} className="rounded-xl border px-4 py-2 font-bold" style={payment === p ? { background: color, borderColor: color, color: "#fff" } : { borderColor: "#e4e4e7" }}>
                  {p}
                </button>
              ))}
            </div>
            {payment === "Efectivo" && type === "Domicilio" && (
              <input value={cashWith} onChange={(e) => setCashWith(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="¿Con cuánto pagas? (para llevarte cambio)" className={field} />
            )}
            {payment === "Transferencia" && (
              <p className="mt-2 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800">
                Al enviar tu pedido verás los datos para transferir y se abrirá WhatsApp con tu pedido para mandar el comprobante.
              </p>
            )}
          </div>
        )}

        <label className="mt-4 block text-sm font-bold">
          Nota para el negocio (opcional)
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className={field} />
        </label>

        <div className="mt-5 space-y-1 border-t border-zinc-100 pt-4 text-sm">
          <p className="flex justify-between"><span>Subtotal</span><span>{money(subtotal)}</span></p>
          {fee > 0 && <p className="flex justify-between"><span>Envío</span><span>{money(fee)}</span></p>}
          <p className="flex justify-between text-lg font-black"><span>Total</span><span>{money(total)}</span></p>
        </div>

        {error && <p className="mt-3 text-sm font-bold text-red-600">{error}</p>}
        <button disabled={sending || cart.length === 0} onClick={() => void send()} className="mt-4 w-full rounded-2xl py-4 text-lg font-black text-white disabled:opacity-40" style={{ background: color }}>
          {sending ? "Enviando..." : `Enviar pedido · ${money(total)}`}
        </button>
        <p className="mt-2 text-center text-xs text-zinc-400">Sin comisiones. El negocio confirma tu pedido en unos minutos.</p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ seguimiento

const STEPS = [
  { key: "nuevo", label: "Recibido", icon: "🧾" },
  { key: "aceptado", label: "Preparando", icon: "👨‍🍳" },
  { key: "listo", label: "Listo", icon: "✅" },
  { key: "entregado", label: "Entregado", icon: "🎉" },
] as const;

function OrderTracking({ slug, placed, data, onBack }: { slug: string; placed: Placed; data: PublicMenu | null; onBack: () => void }) {
  const [status, setStatus] = useState<OrderStatus | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const color = data?.business.color || "#f97316";
  const name = data?.business.name || "";

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const { data: s } = await getSupabase().rpc("bpos_menu_order_status", { p_id: placed.id, p_token: placed.token });
      if (alive) setStatus((s as OrderStatus) || null);
    };
    void check();
    const timer = setInterval(() => void check(), 8000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [placed]);

  if (status === undefined) return <Shell><p className="py-24 text-center text-zinc-500">Buscando tu pedido...</p></Shell>;
  if (status === null) {
    return (
      <Shell>
        <div className="py-24 text-center">
          <p className="text-zinc-500">No encontramos ese pedido.</p>
          <button onClick={onBack} className="mt-4 font-black underline">Ver el menú</button>
        </div>
      </Shell>
    );
  }

  const stepIndex = status.status === "aceptando" ? 0 : Math.max(0, STEPS.findIndex((s) => s.key === status.status));
  const readyAt = status.eta_minutes ? new Date(Date.parse(status.updated_at) + status.eta_minutes * 60000) : null;
  const d = status.data;
  const wa = data ? whatsappNumber(data.menu.whatsapp) : "";
  const bank = data?.menu.bank;
  const transfer = d.payment === "Transferencia" && status.status !== "rechazado";
  const message = orderWhatsappText(name || slug, status.folio, d);

  async function copyClabe() {
    if (!bank?.clabe) return;
    try {
      await navigator.clipboard.writeText(bank.clabe);
      setCopied(true);
    } catch {}
  }

  return (
    <Shell>
      <div className="mx-auto max-w-lg px-4 py-8">
        <p className="text-center text-sm text-zinc-500">Pedido en {name || slug} · {status.branch}</p>
        <p className="mt-1 text-center text-xs font-bold tracking-widest text-zinc-400">FOLIO</p>
        <h1 className="text-center text-4xl font-black tracking-widest">{status.folio}</h1>

        {status.status === "rechazado" ? (
          <div className="mt-6 rounded-2xl bg-red-50 p-5 text-center">
            <p className="text-lg font-black text-red-700">No pudimos tomar tu pedido</p>
            <p className="mt-1 text-sm text-red-600">{status.reason}</p>
          </div>
        ) : (
          <>
            <p className="mt-4 text-center text-lg font-black">
              {status.status === "nuevo" || status.status === "aceptando"
                ? "Esperando que el negocio confirme tu pedido..."
                : status.status === "aceptado"
                  ? "¡Lo estamos preparando!"
                  : status.status === "listo"
                    ? d.type === "Domicilio" ? "¡Tu pedido va en camino!" : "¡Tu pedido está listo!"
                    : "¡Gracias por tu compra!"}
            </p>
            {readyAt && status.status === "aceptado" && (
              <p className="text-center text-sm text-zinc-500">Estará listo aprox. a las {readyAt.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" })}</p>
            )}
            <div className="mt-6 flex items-start justify-between">
              {STEPS.map((s, i) => (
                <div key={s.key} className="flex flex-1 flex-col items-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full text-xl" style={{ background: i <= stepIndex ? color : "#e4e4e7" }}>
                    {s.icon}
                  </span>
                  <span className={`mt-1 text-xs font-bold ${i <= stepIndex ? "" : "text-zinc-400"}`}>{s.label}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {transfer && bank && (
          <div className="mt-6 rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-5">
            <p className="font-black text-emerald-800">💳 Transfiere {money(d.total)}</p>
            <div className="mt-2 space-y-1 text-sm">
              {bank.bank && <p>Banco: <b>{bank.bank}</b></p>}
              <p>
                CLABE: <b className="select-all font-mono">{bank.clabe}</b>
                <button onClick={() => void copyClabe()} className="ml-2 rounded-lg bg-white px-2 py-0.5 text-xs font-bold">{copied ? "Copiada" : "Copiar"}</button>
              </p>
              {bank.holder && <p>A nombre de: <b>{bank.holder}</b></p>}
              <p>Concepto: <b>Pedido {status.folio}</b></p>
            </div>
            {wa && (
              <a href={waLink(wa, message)} target="_blank" rel="noreferrer" className="mt-4 block rounded-xl bg-[#25d366] py-3 text-center font-black text-white">
                Enviar pedido y comprobante por WhatsApp
              </a>
            )}
          </div>
        )}

        <div className="mt-8 rounded-2xl border border-dashed border-zinc-300 bg-white p-5 font-mono text-sm">
          <p className="text-center font-black">{(name || "").toUpperCase()}</p>
          <p className="mt-2 flex justify-between"><span>Cliente</span><span>{d.customer.name}</span></p>
          <p className="flex justify-between"><span>Entrega</span><span>{d.type === "Mesa" ? `Mesa ${d.table}` : d.type === "Domicilio" ? "A domicilio" : "Para recoger"}</span></p>
          <p className="flex justify-between"><span>Pago</span><span>{d.payment}</span></p>
          {mapsLink(d.customer.location) && <p className="flex justify-between"><span>Ubicación</span><span>📍 compartida</span></p>}
          <div className="my-3 border-t border-dashed border-zinc-300" />
          {d.lines.map((l, i) => (
            <div key={i} className="mb-1">
              <p className="flex justify-between gap-2"><span>{l.quantity} x {l.name}</span><span>{money(l.unitPrice * l.quantity)}</span></p>
              {l.summary && <p className="pl-4 text-xs text-zinc-500">{l.summary}</p>}
              {l.comment && <p className="pl-4 text-xs italic text-zinc-500">“{l.comment}”</p>}
            </div>
          ))}
          <div className="my-3 border-t border-dashed border-zinc-300" />
          {d.deliveryFee > 0 && <p className="flex justify-between"><span>Envío</span><span>{money(d.deliveryFee)}</span></p>}
          <p className="flex justify-between font-black"><span>TOTAL</span><span>{money(d.total)}</span></p>
          <p className="mt-3 text-center text-xs text-zinc-500">Ticket digital · bpos.com.mx</p>
        </div>

        <button onClick={onBack} className="mt-6 w-full rounded-2xl border border-zinc-300 py-3 font-black">Hacer otro pedido</button>
      </div>
    </Shell>
  );
}
