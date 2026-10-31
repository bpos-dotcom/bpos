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
  awaitingOnlinePayment,
  isAvailableOnline,
  isOpenNow,
  mapsLink,
  normalizeDigitalMenu,
  onlineGroups,
  orderWhatsappText,
  paidOnline,
  scheduledLabel,
  whatsappNumber,
  type Align,
  type DigitalMenuSettings,
  type OnlineOrderData,
  type OnlineOrderLine,
  type OnlineOrderType,
} from "@/lib/digital-menu";
import { couponDiscount } from "@/lib/coupons";
import { isOnSale, scheduleLabel } from "@/lib/sale-schedule";
import { getSupabase } from "@/lib/supabase/client";
import { AddressMap } from "@/components/menu/AddressMap";
import { AccountSheet, useCustomer, type Customer, type CustomerOrder } from "@/components/menu/CustomerAccount";
import { InstallApp } from "@/components/menu/InstallApp";

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
  /** Su calificación, si ya la dio */
  review: { stars: number; comment: string } | null;
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
  const customer = useCustomer(slug);

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
        customer={customer}
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
      customer={customer}
      onPlaced={(p) => {
        setPlaced(p);
        window.history.replaceState(null, "", `/m/${slug}?pedido=${p.id}&t=${p.token}`);
      }}
    />
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  // Siempre claro: el modo claro/oscuro de B-POS (mismo sitio) no aplica al menú de los clientes
  useEffect(() => {
    document.documentElement.classList.remove("theme-light");
  }, []);
  return <div className="min-h-screen w-full bg-[#fff8f1] text-zinc-900 [color-scheme:light]">{children}</div>;
}

/** Textos y botones encima de la imagen: a la izquierda, al centro o a la derecha (con el difuminado de ese lado) */
const ALIGN: Record<Align, { box: string; row: string; fade: string }> = {
  left: { box: "items-start text-left", row: "justify-start", fade: "bg-gradient-to-r from-white/90 via-white/50 to-transparent" },
  center: { box: "items-center text-center", row: "justify-center", fade: "bg-white/55" },
  right: { box: "items-end text-right", row: "justify-end", fade: "bg-gradient-to-l from-white/90 via-white/50 to-transparent" },
};

/** Foto del producto, o su emoji en un fondo suave si no tiene. */
function Photo({ product, className = "", emoji = "text-5xl" }: { product: Pick<Product, "image" | "emoji" | "name">; className?: string; emoji?: string }) {
  if (product.image) {
    // eslint-disable-next-line @next/next/no-img-element -- fotos del negocio en la nube
    return <img src={product.image} alt={product.name} loading="lazy" className={`object-cover ${className}`} />;
  }
  return <div className={`flex items-center justify-center bg-orange-50 ${emoji} ${className}`}>{product.emoji || "🍽️"}</div>;
}

// ------------------------------------------------------------ menú

type CartLine = OnlineOrderLine & { key: string };

function Menu({ data, table, customer, onPlaced }: { data: PublicMenu; table: string; customer: Customer; onPlaced: (p: Placed) => void }) {
  const { business, menu } = data;
  const design = menu.design;
  const color = business.color || "#f97316";
  const [now] = useState(() => new Date());
  const [category, setCategory] = useState("Todos");
  const [search, setSearch] = useState("");
  const [choosing, setChoosing] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [checkout, setCheckout] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountStart, setAccountStart] = useState<"entrar" | "registro">("entrar");
  const [reorderNote, setReorderNote] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  /** Recuadro deslizante del menú */
  const boxRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  /** Alto del encabezado fijo: las categorías del menú se pegan justo debajo */
  const [headerH, setHeaderH] = useState(57);
  /** La imagen de "Pide donde quieras" es horizontal: va a todo lo ancho (si es cuadrada, de lado) */
  const [channelsWide, setChannelsWide] = useState(true);
  /** Producto recién agregado (se ilumina un momento) */
  const [flash, setFlash] = useState<number | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeaderH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const open = isOpenNow(menu, now);
  const canOrderNow = menu.acceptOrders && open;
  // Cerrado pero con pedidos programados: se puede armar el pedido y programarlo para cuando abra
  const canSchedule = menu.acceptOrders && !open && menu.scheduling.enabled && !table;
  const canOrder = canOrderNow || canSchedule;
  const visible = useMemo(
    () => data.products.filter((p) => !p.notSoldAlone && isAvailableOnline(menu, p, now) && !onlineGroups(p, data.products, menu, now).blocked),
    [data.products, menu, now]
  );
  const byId = useMemo(() => new Map(visible.map((p) => [Number(p.id), p])), [visible]);
  const categories = useMemo(() => Array.from(new Set(visible.map((p) => p.category || "Otros"))), [visible]);
  const shown = visible.filter(
    (p) => (category === "Todos" || (p.category || "Otros") === category) && p.name.toLowerCase().includes(search.trim().toLowerCase())
  );
  /** "Todos" sin búsqueda: el recuadro va por categorías, con su título */
  const grouped = category === "Todos" && !search.trim();
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
    boxRef.current?.scrollTo({ top: 0 });
    menuRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const hero = design.hero;
  const heroText = Boolean(hero.eyebrow || hero.title || hero.highlight || hero.text || hero.badges.some(Boolean));
  const heroOnImage = Boolean(hero.image);

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
    setFlash(Number(product.id));
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 900);
    setCart((c) => {
      const found = c.find((l) => l.key === key);
      if (found) return c.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
      return [...c, { key, productId: product.id, name: product.name, quantity: 1, unitPrice, picks: { [OWN_OPTIONS]: picks }, summary, ...(comment ? { comment } : {}) }];
    });
  }

  /** "Pedir otra vez": lo de un pedido anterior, con los precios de hoy; lo que ya no hay se avisa */
  function reorder(order: CustomerOrder) {
    const missing: string[] = [];
    const lines: CartLine[] = [];
    for (const l of order.data.lines) {
      const product = byId.get(Number(l.productId));
      if (!product) {
        missing.push(l.name);
        continue;
      }
      const picks = (l.picks?.[OWN_OPTIONS] || {}) as Picks;
      const selection = buildSelection(product, data.products, { [OWN_OPTIONS]: picks });
      const unitPrice = Number(product.price) + extrasPrice(selection.modifiers, selection.parts);
      const comment = l.comment || "";
      lines.push({ key: `${product.id}|${JSON.stringify(picks)}|${comment}`, productId: product.id, name: product.name, quantity: l.quantity, unitPrice, picks: { [OWN_OPTIONS]: picks }, summary: l.summary, ...(comment ? { comment } : {}) });
    }
    setCart((c) => {
      const next = [...c];
      for (const line of lines) {
        const i = next.findIndex((x) => x.key === line.key);
        if (i >= 0) next[i] = { ...next[i], quantity: next[i].quantity + line.quantity };
        else next.push(line);
      }
      return next;
    });
    setAccountOpen(false);
    setReorderNote(missing.length ? `Hoy no hay: ${missing.join(", ")}` : "");
    if (lines.length) setCheckout(true);
  }

  const hoursText = menu.hours ? scheduleLabel(menu.hours) : "";
  /** Cuántos de cada producto lleva el cliente (todas sus variantes) */
  const inCart = new Map<number, number>();
  for (const l of cart) inCart.set(Number(l.productId), (inCart.get(Number(l.productId)) || 0) + l.quantity);
  /** El "+" cambia por cuántos lleva */
  const plusBtn = (product: Product) => {
    const n = inCart.get(Number(product.id)) || 0;
    return (
      <span
        className={`flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full px-1.5 font-black text-white shadow transition-transform ${n ? "text-sm ring-2 ring-white" : "text-lg"} ${flash === Number(product.id) ? "scale-125" : ""}`}
        style={{ background: color }}
        aria-label={n ? `Llevas ${n}` : "Agregar"}
      >
        {n || "+"}
      </span>
    );
  };
  /** Al agregar, la tarjeta se ilumina un momento en el color del negocio */
  const glow = (product: Product): React.CSSProperties =>
    flash === Number(product.id) ? { borderColor: color, background: `${color}26`, boxShadow: `0 0 0 3px ${color}80` } : {};
  /** Tarjeta de producto en cuadro: foto, nombre, precio y "+" (o cuántos lleva) */
  const card = (p: Product, opts: { rank?: number; className?: string } = {}) => (
    <button
      key={p.id}
      disabled={!canOrder}
      onClick={() => pick(p)}
      style={glow(p)}
      className={`relative flex flex-col overflow-hidden rounded-xl border border-orange-100 bg-white text-left shadow-sm transition-all duration-300 hover:shadow-md disabled:cursor-default ${opts.className || ""}`}
    >
      {opts.rank ? <span className="absolute left-1.5 top-1.5 z-10 rounded-full bg-zinc-900 px-1.5 py-0.5 text-[10px] font-black text-white">#{opts.rank}</span> : null}
      <Photo product={p} emoji="text-4xl" className="h-16 w-full md:h-24" />
      <span className="flex flex-1 flex-col p-2">
        <span className="line-clamp-2 text-xs font-black leading-tight md:text-sm">{p.name}</span>
        <span className="mt-auto flex items-center justify-between pt-1">
          <span className="text-sm font-black" style={{ color }}>{price(Number(p.price))}</span>
          {canOrder && plusBtn(p)}
        </span>
      </span>
    </button>
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

      <header ref={headerRef} className="sticky top-0 z-20 border-b border-orange-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- logo del negocio */}
          <img src={business.logo || "/bpos-logo.png"} alt="" className="h-10 w-10 rounded-xl object-contain" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-black uppercase tracking-tight">{business.name}</p>
            <p className="truncate text-xs text-zinc-500">
              {data.branch}
              {table && <b className="ml-1 text-zinc-800">· Mesa {table}</b>}
            </p>
          </div>
          <span className={`hidden rounded-full px-3 py-1 text-xs font-black sm:inline ${canOrderNow ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-600"}`}>
            {canOrderNow ? "Abierto" : menu.acceptOrders ? "Cerrado" : "Solo menú"}
          </span>
          <button
            onClick={() => setAccountOpen(true)}
            aria-label="Mi cuenta"
            className="flex h-10 shrink-0 items-center gap-1 rounded-full border border-orange-100 bg-white px-3 text-sm font-black shadow-sm"
          >
            👤<span className="hidden sm:inline">{customer.account ? customer.account.name.split(" ")[0] : "Mi cuenta"}</span>
          </button>
          {count > 0 && (
            <button onClick={() => setCheckout(true)} className="rounded-full px-4 py-2 text-sm font-black text-white" style={{ background: color }}>
              🛒 {count} · {money(total)}
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-32">
        {menu.notice && <p className="mt-4 rounded-2xl px-4 py-3 text-sm font-bold text-white" style={{ background: color }}>{menu.notice}</p>}
        {!canOrderNow && menu.acceptOrders && (
          <p className="mt-4 rounded-2xl bg-zinc-200 px-4 py-3 text-sm text-zinc-700">
            {canSchedule
              ? `Ahora estamos cerrados${hoursText ? ` · Horario: ${hoursText}` : ""}. Puedes armar tu pedido y programarlo para cuando abramos (con tu cuenta).`
              : `Ahora no estamos recibiendo pedidos${hoursText ? ` · Horario: ${hoursText}` : ""}. Puedes ver el menú.`}
          </p>
        )}

        {/* Portada */}
        {/* Portada: la imagen va a todo lo ancho y los textos encima, a la izquierda */}
        {hero.on && (heroText || heroOnImage) && (
          <section className={`relative mt-3 overflow-hidden rounded-3xl ${heroOnImage ? "bg-orange-50" : "bg-gradient-to-br from-white to-orange-50"}`}>
            {heroOnImage && (
              // eslint-disable-next-line @next/next/no-img-element -- portada del negocio
              <img src={hero.image} alt="" className={`block max-h-[460px] w-full object-cover ${heroText ? "min-h-[200px]" : ""}`} />
            )}
            <div
              className={
                heroOnImage
                  ? `absolute inset-0 flex flex-col p-5 md:p-10 ${ALIGN[hero.align].box} ${heroText ? `justify-center ${ALIGN[hero.align].fade}` : "justify-end"}`
                  : `flex flex-col p-5 md:p-8 ${ALIGN[hero.align].box}`
              }
            >
              <div className="max-w-md md:max-w-xl">
                {hero.eyebrow && <p className="text-[10px] font-black uppercase tracking-[0.3em] md:text-xs" style={{ color }}>{hero.eyebrow}</p>}
                {(hero.title || hero.highlight) && (
                  <h1 className="mt-1 text-3xl font-black uppercase leading-none tracking-tight md:text-6xl">
                    {hero.title}
                    {hero.highlight && <span className="block" style={{ color }}>{hero.highlight}</span>}
                  </h1>
                )}
                {hero.text && <p className={`mt-3 max-w-md text-sm text-zinc-700 md:text-base ${heroOnImage ? "hidden md:block" : ""}`}>{hero.text}</p>}
                {hero.badges.some(Boolean) && (
                  <div className={`mt-3 flex-wrap gap-2 ${ALIGN[hero.align].row} ${heroOnImage ? "hidden md:flex" : "flex"}`}>
                    {hero.badges.filter(Boolean).map((b) => (
                      <span key={b} className="rounded-full border bg-white/70 px-3 py-1 text-xs font-bold" style={{ borderColor: color, color }}>
                        {b}
                      </span>
                    ))}
                  </div>
                )}
                <button onClick={() => goToMenu()} className="mt-4 rounded-full px-5 py-2.5 text-sm font-black text-white shadow-lg md:mt-6 md:px-7 md:py-3 md:text-base" style={{ background: color }}>
                  {hero.button || "Ver menú"} →
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Categorías */}
        {categories.length > 1 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {categories.map((c) => {
              const sample = visible.find((p) => (p.category || "Otros") === c && p.image) || visible.find((p) => (p.category || "Otros") === c)!;
              return (
                <button key={c} onClick={() => goToMenu(c)} className="w-20 shrink-0 overflow-hidden rounded-xl border border-orange-100 bg-white text-center shadow-sm hover:shadow-md">
                  <Photo product={sample} emoji="text-3xl" className="h-12 w-full" />
                  <span className="block truncate px-1 py-1 text-[11px] font-black">{c}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Combo destacado */}
        {design.featured.on && featured && (
          <section className="mt-4 grid items-center gap-4 overflow-hidden rounded-3xl bg-zinc-950 p-4 text-white md:grid-cols-2 md:p-8">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.3em]" style={{ color }}>{design.featured.eyebrow}</p>
              <h2 className="mt-1 text-2xl font-black md:text-3xl">{featured.name}</h2>
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
                <Photo product={featured} emoji="text-7xl" className="aspect-[16/10] w-full rounded-2xl" />
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
          <section className="mt-5">
            <h2 className="text-xl font-black">🔥 {design.top.title}</h2>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {top.map(({ product, qty }, i) => card(product, { rank: qty > 0 ? i + 1 : 0, className: "w-32 shrink-0 md:w-40" }))}
            </div>
          </section>
        )}

        {/* Menú completo */}
        <section ref={menuRef} className="mt-5" style={{ scrollMarginTop: headerH + 4 }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-black">Menú</h2>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar un platillo..." className="w-full max-w-xs rounded-full border border-orange-100 bg-white px-4 py-2 text-sm outline-none focus:border-orange-300" />
          </div>
          <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
            {["Todos", ...categories].map((c) => (
              <button
                key={c}
                onClick={() => goToMenu(c)}
                className="shrink-0 rounded-full border px-3 py-1 text-sm font-bold"
                style={category === c ? { background: color, borderColor: color, color: "#fff" } : { borderColor: "#fed7aa", background: "#fff" }}
              >
                {c}
              </button>
            ))}
          </div>
          {/* Recuadro deslizante: unos 6 platillos a la vista; se desliza por dentro y la página sigue corta */}
          <div ref={boxRef} className="mt-1 max-h-[470px] overflow-y-auto rounded-2xl border border-orange-100 bg-white p-2 shadow-inner md:max-h-[560px]">
            {grouped ? (
              categories.map((c) => (
                <div key={c}>
                  <h3 className="sticky top-0 z-[1] -mx-2 bg-white/95 px-2 py-1.5 text-sm font-black backdrop-blur">{c}</h3>
                  <div className="grid grid-cols-2 gap-2 pb-2 sm:grid-cols-3 lg:grid-cols-4">
                    {visible.filter((p) => (p.category || "Otros") === c).map((p) => card(p))}
                  </div>
                </div>
              ))
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{shown.map((p) => card(p))}</div>
            )}
            {shown.length === 0 && <p className="py-12 text-center text-zinc-500">No hay platillos en esta sección.</p>}
          </div>
          {shown.length > 6 && <p className="mt-1 text-center text-xs font-bold text-zinc-400">Desliza dentro del menú para ver más ↓</p>}
        </section>

        {/* Pide donde quieras: imagen horizontal a todo lo ancho con los botones encima; mascota cuadrada, de lado */}
        {channels.on && links.length > 0 && (
          <section
            className={`relative mt-6 overflow-hidden rounded-3xl border border-orange-100 bg-white ${channels.image && channelsWide ? "" : "grid items-center gap-3 p-4 md:grid-cols-[auto_1fr_auto]"}`}
          >
            {channels.image && (
              // eslint-disable-next-line @next/next/no-img-element -- imagen del negocio
              <img
                src={channels.image}
                alt=""
                onLoad={(e) => setChannelsWide(e.currentTarget.naturalWidth >= e.currentTarget.naturalHeight * 1.6)}
                className={channelsWide ? "block max-h-[360px] min-h-[180px] w-full object-cover" : "h-20 w-20 object-contain"}
              />
            )}
            <div
              className={
                channels.image && channelsWide
                  ? `absolute inset-0 flex flex-col justify-center gap-3 p-5 md:p-8 ${ALIGN[channels.align].box} ${ALIGN[channels.align].fade}`
                  : "contents"
              }
            >
              <div>
                <h2 className="text-xl font-black leading-tight md:text-3xl">
                  {channels.title} <span style={{ color }}>{channels.highlight}</span>
                </h2>
                {channels.text && <p className={`max-w-md text-sm text-zinc-600 ${channels.image && channelsWide ? "hidden md:block" : ""}`}>{channels.text}</p>}
              </div>
              <div className={`flex flex-wrap gap-2 ${channels.image && channelsWide ? ALIGN[channels.align].row : ""}`}>
                {links.map((l) => (
                  <a key={l.key} href={l.href} target="_blank" rel="noreferrer" className={`rounded-xl px-3 py-2 text-sm font-black shadow md:px-4 md:py-3 ${l.cls}`}>
                    {l.label} →
                  </a>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Banner final */}
        {design.banner.on && (design.banner.image || design.banner.title) && (
          <section className="relative mt-5 overflow-hidden rounded-3xl" style={{ background: `linear-gradient(90deg, #ffe2c4, ${color})` }}>
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

        <InstallApp slug={data.slug} name={business.name} color={color} />

        <p className="mt-8 text-center text-xs text-zinc-400">Menú digital por bpos.com.mx · pedidos sin comisión</p>
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
          customer={customer}
          closed={!canOrderNow}
          notice={reorderNote}
          onNeedAccount={(start) => {
            setAccountStart(start);
            setAccountOpen(true);
          }}
          onClose={() => {
            setCheckout(false);
            setReorderNote("");
          }}
          onPlaced={onPlaced}
        />
      )}

      {accountOpen && (
        <AccountSheet
          slug={data.slug}
          color={color}
          businessName={business.name}
          customer={customer}
          start={accountStart}
          onClose={() => {
            setAccountOpen(false);
            setAccountStart("entrar");
          }}
          onReorder={canOrder ? reorder : undefined}
          onOpenOrder={(o) => onPlaced({ id: o.id, token: o.token, folio: o.folio })}
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
                        <span className="font-bold">
                          {optionName(o, catalog)}
                          {Number(o.extraPrice) > 0 && <span className="ml-1 text-xs text-zinc-500">+{money(Number(o.extraPrice))}</span>}
                        </span>
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
  customer,
  closed,
  notice,
  onNeedAccount,
  onClose,
  onPlaced,
}: {
  data: PublicMenu;
  color: string;
  table: string;
  cart: CartLine[];
  setCart: React.Dispatch<React.SetStateAction<CartLine[]>>;
  customer: Customer;
  /** El negocio está cerrado: solo se puede programar */
  closed: boolean;
  /** Aviso de "Pedir otra vez" (lo que ya no hay) */
  notice: string;
  /** Programar pide cuenta: abre registro o entrar */
  onNeedAccount: (start: "entrar" | "registro") => void;
  onClose: () => void;
  onPlaced: (p: Placed) => void;
}) {
  const { menu, slug } = data;
  const wa = whatsappNumber(menu.whatsapp);
  // Recoger y domicilio se muestran siempre; lo que el negocio no ofrece sale como "No disponible"
  const offered: Record<OnlineOrderType, boolean> = { Recoger: menu.pickup, Domicilio: menu.delivery, Mesa: Boolean(table) };
  const [type, setType] = useState<OnlineOrderType>(table ? "Mesa" : menu.pickup || !menu.delivery ? "Recoger" : "Domicilio");
  // Formas de pago de ese tipo de pedido; transferencia solo con CLABE y WhatsApp del negocio
  // Mercado Pago solo si el negocio tiene su cuenta vinculada (se pregunta al servidor)
  const [mpOk, setMpOk] = useState(false);
  const wantsMp = Object.values(menu.paymentsByType).some((l) => l.includes("Mercado Pago"));
  useEffect(() => {
    if (!wantsMp) return;
    let alive = true;
    fetch(`/api/menu/pago?liga=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((b) => alive && setMpOk(Boolean(b?.available)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [wantsMp, slug]);
  const payments = menu.paymentsByType[type].filter((p) => (p !== "Transferencia" || (wa && menu.bank.clabe.length === 18)) && (p !== "Mercado Pago" || mpOk));
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [reference, setReference] = useState("");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  /** El pin está en la casa (GPS, movido o confirmado); no solo en la calle del buscador */
  const [pinOk, setPinOk] = useState(false);
  /** La dirección la llenó el mapa (se puede reemplazar); si la escribió el cliente, se respeta */
  const [addressAuto, setAddressAuto] = useState(false);
  const [chosenPayment, setPayment] = useState<OnlineOrderData["payment"]>(payments[0] || "Efectivo");
  // Si cambia el tipo de pedido y esa forma de pago no aplica, se toma la primera permitida
  const payment = payments.includes(chosenPayment) ? chosenPayment : payments[0];
  const [cashWith, setCashWith] = useState("");
  const [note, setNote] = useState("");
  /** Cupón revisado en la nube; el descuento se recalcula si cambia el pedido */
  const [coupon, setCoupon] = useState<{ code: string; kind: "percent" | "amount"; value: number; minPurchase: number; maxDiscount: number } | null>(null);
  const [couponInput, setCouponInput] = useState("");
  const [couponError, setCouponError] = useState("");
  const [checkingCoupon, setCheckingCoupon] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  /** ¿Para cuándo? Programar solo con cuenta (así se sabe que es un cliente real) */
  const [when, setWhen] = useState<"ahora" | "programar">(closed ? "programar" : "ahora");
  const [day, setDay] = useState(0);
  const [slot, setSlot] = useState("");
  const sched = menu.scheduling;
  const [openedAt] = useState(() => Date.now());
  const slots = useMemo(() => {
    if (!sched.enabled) return [] as { day: number; label: string; times: { value: string; label: string }[] }[];
    const earliest = openedAt + sched.minMinutes * 60000;
    return Array.from({ length: sched.maxDays + 1 }, (_, i) => {
      const base = new Date(openedAt);
      base.setHours(0, 0, 0, 0);
      base.setDate(base.getDate() + i);
      const times: { value: string; label: string }[] = [];
      for (let m = 0; m < 24 * 60; m += 15) {
        const t = new Date(base.getTime() + m * 60000);
        if (t.getTime() >= earliest && isOnSale(menu.hours, t)) times.push({ value: t.toISOString(), label: t.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" }) });
      }
      const label = i === 0 ? "Hoy" : i === 1 ? "Mañana" : base.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
      return { day: i, label, times };
    }).filter((d) => d.times.length > 0);
  }, [sched.enabled, sched.minMinutes, sched.maxDays, menu.hours, openedAt]);
  const dayTimes = slots.find((d) => d.day === day)?.times || slots[0]?.times || [];
  const scheduledFor = when === "programar" && customer.account ? (dayTimes.some((t) => t.value === slot) ? slot : "") : "";

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("bpos_menu_customer") || "{}");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- datos guardados del cliente
      if (saved.name) setName(saved.name);
      if (saved.phone) setPhone(saved.phone);
      if (saved.address) setAddress(saved.address);
    } catch {}
    // Con cuenta: sus datos y su última dirección
    const a = customer.account;
    if (a) {
      setName(a.name);
      setPhone(a.phone);
      if (a.address?.address) setAddress(a.address.address);
      if (a.address?.reference) setReference(a.address.reference);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir
  }, []);

  const subtotal = cart.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const fee = type === "Domicilio" ? menu.deliveryFee : 0;
  const couponOk = coupon && subtotal >= coupon.minPurchase ? coupon : null;
  const discount = couponOk ? couponDiscount(couponOk, subtotal) : 0;
  const total = Math.max(0, subtotal + fee - discount);

  async function applyCoupon() {
    setCouponError("");
    setCheckingCoupon(true);
    try {
      const { data: res, error: e } = await getSupabase().rpc("bpos_menu_coupon", { p_slug: slug, p_code: couponInput, p_subtotal: subtotal });
      if (e) throw new Error(e.message);
      const r = res as { code: string; kind: "percent" | "amount"; value: number; minPurchase: number; maxDiscount: number };
      setCoupon({ code: r.code, kind: r.kind === "amount" ? "amount" : "percent", value: Number(r.value), minPurchase: Number(r.minPurchase), maxDiscount: Number(r.maxDiscount) });
    } catch (e) {
      setCoupon(null);
      setCouponError(e instanceof Error ? e.message : "No se pudo revisar el cupón.");
    } finally {
      setCheckingCoupon(false);
    }
  }
  const belowMin = menu.minOrder > 0 && subtotal < menu.minOrder;

  function qty(key: string, delta: number) {
    setCart((c) => c.map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l)).filter((l) => l.quantity > 0));
  }

  async function send() {
    setError("");
    if (!name.trim()) return setError("Escribe tu nombre.");
    if (type !== "Mesa" && phone.replace(/\D/g, "").length < 10) return setError("Escribe tu teléfono a 10 dígitos para avisarte.");
    if (type === "Domicilio" && !address.trim()) return setError("Escribe la dirección de entrega.");
    if (type === "Domicilio" && location && !pinOk) return setError("Pon el pin del mapa justo en tu casa (o toca \"Ya está en mi casa\").");
    if (belowMin) return setError(`El pedido mínimo es de ${money(menu.minOrder)}.`);
    if (!offered[type]) return setError(type === "Domicilio" ? "Por ahora no tenemos servicio a domicilio. Elige para recoger." : "Por ahora no tenemos pedidos para recoger.");
    if (!payment) return setError("El negocio no tiene formas de pago para este tipo de pedido.");
    if (closed && (when !== "programar" || !scheduledFor)) return setError(customer.account ? "Estamos cerrados: elige el día y la hora de tu pedido." : "Estamos cerrados: entra a tu cuenta para programar tu pedido.");
    if (when === "programar" && !customer.account) return setError("Para programar tu pedido entra a tu cuenta, o elige pedir ahora.");
    if (when === "programar" && !scheduledFor) return setError("Elige el día y la hora de tu pedido.");
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
      ...(scheduledFor ? { scheduledFor } : {}),
      lines: cart.map(({ productId, name: n, quantity, unitPrice, picks, summary, comment }) => ({ productId, name: n, quantity, unitPrice, picks, summary, ...(comment ? { comment } : {}) })),
      subtotal,
      deliveryFee: fee,
      ...(couponOk && discount > 0 ? { coupon: { code: couponOk.code, discount } } : {}),
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
      if (customer.token) void customer.linkOrder(p.id, p.token);
      // Transferencia: se abre WhatsApp con el desglose (si el navegador lo bloquea, queda el botón en el seguimiento)
      if (payment === "Transferencia" && wa) window.open(waLink(wa, orderWhatsappText(data.business.name, p.folio, order)), "_blank");
      // Mercado Pago: a pagar; al terminar regresa al seguimiento (si falla, ahí queda el botón para pagar)
      if (payment === "Mercado Pago") {
        const url = await startOnlinePayment(p).catch(() => "");
        if (url) {
          window.history.replaceState(null, "", `/m/${slug}?pedido=${p.id}&t=${p.token}`);
          window.location.assign(url);
          return;
        }
      }
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
        {notice && <p className="mt-2 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800">⚠️ {notice}</p>}
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

        {sched.enabled && type !== "Mesa" && slots.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-bold">¿Para cuándo?</p>
            {closed && <p className="mt-1 text-xs font-bold text-zinc-500">Ahora estamos cerrados: programa tu pedido para cuando abramos.</p>}
            <div className={`mt-1 grid gap-2 ${closed ? "grid-cols-1" : "grid-cols-2"}`}>
              {(
                [
                  ["ahora", "⚡ Lo antes posible"],
                  ["programar", "📅 Programar"],
                ] as const
              ).filter(([k]) => !closed || k === "programar").map(([k, text]) => (
                <button
                  key={k}
                  onClick={() => setWhen(k)}
                  className="rounded-xl border py-3 font-black"
                  style={when === k ? { background: color, borderColor: color, color: "#fff" } : { borderColor: "#e4e4e7" }}
                >
                  {text}
                </button>
              ))}
            </div>
            {when === "programar" &&
              (customer.account ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <select value={slots.some((d) => d.day === day) ? day : slots[0].day} onChange={(e) => { setDay(Number(e.target.value)); setSlot(""); }} className={field}>
                    {slots.map((d) => (
                      <option key={d.day} value={d.day}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                  <select value={scheduledFor} onChange={(e) => setSlot(e.target.value)} className={field}>
                    <option value="">Hora</option>
                    {dayTimes.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  {scheduledFor && <p className="col-span-2 text-sm font-bold text-emerald-700">📅 Tu pedido quedará para {scheduledLabel(scheduledFor)}</p>}
                </div>
              ) : (
                <div className="mt-2 rounded-2xl border-2 border-dashed p-4 text-center" style={{ borderColor: color }}>
                  <p className="font-black">Para programar pedidos necesitas tu cuenta</p>
                  <p className="mt-1 text-sm text-zinc-500">Es gratis y te toma un minuto. Así el restaurante sabe que tu pedido es real.</p>
                  <button onClick={() => onNeedAccount("registro")} className="mt-3 w-full rounded-xl py-3 font-black text-white" style={{ background: color }}>
                    Crear mi cuenta
                  </button>
                  <button onClick={() => onNeedAccount("entrar")} className="mt-2 w-full rounded-xl border border-zinc-200 py-2.5 font-black">
                    Ya tengo cuenta: entrar
                  </button>
                  {!closed && (
                    <button onClick={() => setWhen("ahora")} className="mt-2 text-sm font-bold underline" style={{ color }}>
                      Mejor pedir ahora sin cuenta
                    </button>
                  )}
                </div>
              ))}
          </div>
        )}

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
              onChange={(place, found, precise) => {
                setLocation(place);
                setPinOk(precise);
                if (found && (addressAuto || !address.trim())) {
                  setAddress(found);
                  setAddressAuto(true);
                }
              }}
            />
            <label className="mt-3 block text-sm font-bold">
              Dirección de entrega (revisa calle y número)
              <input value={address} onChange={(e) => { setAddress(e.target.value); setAddressAuto(false); }} maxLength={200} name="street-address" autoComplete="street-address" className={field} />
            </label>
            <label className="mt-3 block text-sm font-bold">
              Referencias (opcional)
              <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} placeholder="Casa azul, junto a la tienda" className={field} />
            </label>
          </>
        )}

        {payments.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-bold">
              {payments.length === 1 && payments[0] === "Mercado Pago"
                ? "Pagas en línea con:"
                : `Pagas ${type === "Domicilio" ? "al recibir" : type === "Mesa" ? "en la mesa" : "al recoger"}${payments.includes("Mercado Pago") ? " o en línea" : ""} con:`}
            </p>
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
            {payment === "Mercado Pago" && (
              <p className="mt-2 rounded-xl bg-sky-50 p-3 text-xs text-sky-800">
                Al enviar tu pedido te llevamos a Mercado Pago para pagar con tarjeta de crédito o débito, o con tu saldo. El negocio lo recibe en cuanto se aprueba tu pago.
              </p>
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

        <div className="mt-4">
          <p className="text-sm font-bold">¿Tienes un cupón?</p>
          {couponOk ? (
            <div className="mt-1 flex items-center justify-between rounded-xl border-2 border-emerald-500 bg-emerald-50 px-3 py-2 text-sm">
              <b className="text-emerald-800">🎟️ {couponOk.code} · -{money(discount)}</b>
              <button onClick={() => setCoupon(null)} className="text-xs font-bold text-zinc-500 underline">Quitar</button>
            </div>
          ) : (
            <div className="mt-1 flex gap-2">
              <input
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value.toUpperCase().replace(/[^A-Z0-9Ñ-]/g, "").slice(0, 20))}
                placeholder="CÓDIGO"
                className="min-w-0 flex-1 rounded-xl border border-zinc-200 px-3 py-2.5 font-mono uppercase"
              />
              <button disabled={!couponInput || checkingCoupon} onClick={() => void applyCoupon()} className="rounded-xl px-4 font-black text-white disabled:opacity-40" style={{ background: color }}>
                {checkingCoupon ? "..." : "Aplicar"}
              </button>
            </div>
          )}
          {coupon && !couponOk && <p className="mt-1 text-xs font-bold text-amber-700">El cupón {coupon.code} es para compras desde {money(coupon.minPurchase)}.</p>}
          {couponError && <p className="mt-1 text-xs font-bold text-red-600">{couponError}</p>}
        </div>

        <div className="mt-5 space-y-1 border-t border-zinc-100 pt-4 text-sm">
          <p className="flex justify-between"><span>Subtotal</span><span>{money(subtotal)}</span></p>
          {fee > 0 && <p className="flex justify-between"><span>Envío</span><span>{money(fee)}</span></p>}
          {discount > 0 && couponOk && <p className="flex justify-between text-emerald-700"><span>Cupón {couponOk.code}</span><span>-{money(discount)}</span></p>}
          <p className="flex justify-between text-lg font-black"><span>Total</span><span>{money(total)}</span></p>
        </div>

        {error && <p className="mt-3 text-sm font-bold text-red-600">{error}</p>}
        <button disabled={sending || cart.length === 0} onClick={() => void send()} className="mt-4 w-full rounded-2xl py-4 text-lg font-black text-white disabled:opacity-40" style={{ background: color }}>
          {sending ? "Enviando..." : `${scheduledFor ? "Programar pedido" : payment === "Mercado Pago" ? "Pedir y pagar" : "Enviar pedido"} · ${money(total)}`}
        </button>
        <p className="mt-2 text-center text-xs text-zinc-400">Sin comisiones. El negocio confirma tu pedido en unos minutos.</p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ opinión

/**
 * El cliente califica su pedido. 4 o 5 estrellas: se le invita a dejar su
 * reseña en Google. 1 a 3: su comentario llega solo al negocio (con aviso
 * al celular del dueño) para que lo atienda.
 */
function RateOrder({ placed, color, done }: { placed: Placed; color: string; done: OrderStatus["review"] }) {
  const [stars, setStars] = useState(done?.stars || 0);
  const [comment, setComment] = useState(done?.comment || "");
  const [sent, setSent] = useState<{ google: string } | null>(done ? { google: "" } : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const good = stars >= 4;

  async function send() {
    if (!stars) return;
    setBusy(true);
    setError("");
    try {
      const { data: res, error: e } = await getSupabase().rpc("bpos_menu_review", { p_id: placed.id, p_token: placed.token, p_stars: stars, p_comment: comment });
      if (e) throw new Error(e.message);
      setSent({ google: String((res as { google?: string })?.google || "") });
      // Opinión baja: aviso al celular del dueño (si no se puede, la ve en Opiniones)
      if (stars <= 3) void fetch("/api/push/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: placed.id, token: placed.token }) }).catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="mt-6 rounded-2xl border border-orange-100 bg-white p-5 text-center shadow-sm">
        <p className="text-2xl">{"★".repeat(stars)}<span className="text-zinc-300">{"★".repeat(5 - stars)}</span></p>
        {stars >= 4 ? (
          <>
            <p className="mt-2 font-black">¡Gracias! Nos alegra que te haya gustado 🧡</p>
            {sent.google && (
              <>
                <p className="mt-1 text-sm text-zinc-500">¿Nos ayudas contándolo en Google? Así más gente nos conoce.</p>
                <a href={sent.google} target="_blank" rel="noreferrer" className="mt-3 block rounded-xl py-3 font-black text-white" style={{ background: color }}>
                  ⭐ Dejar mi reseña en Google
                </a>
              </>
            )}
          </>
        ) : (
          <p className="mt-2 font-black">Gracias por decirnos. El negocio ya recibió tu comentario y lo va a atender.</p>
        )}
        {!done && (
          <button onClick={() => setSent(null)} className="mt-3 text-xs font-bold text-zinc-400 underline">
            Cambiar mi calificación
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-2xl border border-orange-100 bg-white p-5 text-center shadow-sm">
      <p className="font-black">¿Cómo estuvo tu pedido?</p>
      <div className="mt-2 flex justify-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setStars(n)} aria-label={`${n} estrellas`} className="text-4xl transition-transform active:scale-90" style={{ color: n <= stars ? "#f59e0b" : "#e4e4e7" }}>
            ★
          </button>
        ))}
      </div>
      {stars > 0 && (
        <>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={600}
            rows={3}
            placeholder={good ? "¿Qué fue lo que más te gustó? (opcional)" : "¿Qué pasó? Cuéntanos para arreglarlo (solo lo ve el negocio)"}
            className="mt-3 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
          />
          <button disabled={busy} onClick={() => void send()} className="mt-2 w-full rounded-xl py-3 font-black text-white disabled:opacity-50" style={{ background: color }}>
            {busy ? "Enviando..." : "Enviar calificación"}
          </button>
        </>
      )}
      {error && <p className="mt-2 text-sm font-bold text-red-600">{error}</p>}
    </div>
  );
}

// ------------------------------------------------------------ seguimiento

/** Liga de Mercado Pago para pagar el pedido (la arma el servidor con la cuenta del negocio) */
async function startOnlinePayment(p: Pick<Placed, "id" | "token">): Promise<string> {
  const r = await fetch("/api/menu/pago", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "pagar", id: p.id, token: p.token }) });
  const b = await r.json().catch(() => null);
  if (!r.ok || !b?.url) throw new Error(b?.error || "Mercado Pago no respondió. Intenta de nuevo.");
  return b.url as string;
}

/** ¿Ya se aprobó el pago? Le pregunta el servidor a Mercado Pago (al regresar de pagar) */
async function checkOnlinePayment(p: Pick<Placed, "id" | "token">) {
  const r = await fetch("/api/menu/pago", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "revisar", id: p.id, token: p.token }) });
  const b = await r.json().catch(() => null);
  return Boolean(b?.mp);
}

const STEPS = [
  { key: "nuevo", label: "Recibido", icon: "🧾" },
  { key: "aceptado", label: "Preparando", icon: "👨‍🍳" },
  { key: "listo", label: "Listo", icon: "✅" },
  { key: "entregado", label: "Entregado", icon: "🎉" },
] as const;

function OrderTracking({ slug, placed, data, customer, onBack }: { slug: string; placed: Placed; data: PublicMenu | null; customer: Customer; onBack: () => void }) {
  const [status, setStatus] = useState<OrderStatus | null | undefined>(undefined);
  const [signup, setSignup] = useState(false);
  const [linked, setLinked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");
  const color = data?.business.color || "#f97316";
  const name = data?.business.name || "";

  useEffect(() => {
    let alive = true;
    let asked = 0;
    const check = async () => {
      const { data: s } = await getSupabase().rpc("bpos_menu_order_status", { p_id: placed.id, p_token: placed.token });
      const st = (s as OrderStatus) || null;
      // Falta el pago en línea: al regresar de Mercado Pago se le pregunta (por si su aviso no ha llegado)
      if (st && st.status === "nuevo" && awaitingOnlinePayment(st.data) && asked < 8 && asked++ % 2 === 0) {
        if (await checkOnlinePayment(placed).catch(() => false)) return void check();
      }
      if (alive) setStatus(st);
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
  const unpaid = awaitingOnlinePayment(d) && status.status === "nuevo";
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
            {d.mp?.status === "refunded" && <p className="mt-2 text-sm font-bold text-red-700">Te devolvimos tu pago de Mercado Pago. Puede tardar unos días en verse en tu tarjeta.</p>}
            {paidOnline(d) && <p className="mt-2 text-sm font-bold text-red-700">El negocio te va a devolver tu pago de Mercado Pago.</p>}
          </div>
        ) : (
          <>
            <p className="mt-4 text-center text-lg font-black">
              {unpaid
                ? "Falta pagar tu pedido"
                : status.status === "nuevo" || status.status === "aceptando"
                ? "Esperando que el negocio confirme tu pedido..."
                : status.status === "aceptado"
                  ? "¡Lo estamos preparando!"
                  : status.status === "listo"
                    ? d.type === "Domicilio" ? "¡Tu pedido va en camino!" : "¡Tu pedido está listo!"
                    : "¡Gracias por tu compra!"}
            </p>
            {d.scheduledFor && (status.status === "nuevo" || status.status === "aceptando") && (
              <p className="mt-1 text-center text-base font-black" style={{ color }}>📅 Programado para {scheduledLabel(d.scheduledFor)}</p>
            )}
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

        {unpaid && (
          <div className="mt-6 rounded-2xl border-2 border-sky-500 bg-sky-50 p-5 text-center">
            <p className="font-black text-sky-900">💳 Paga {money(d.total)} con Mercado Pago</p>
            <p className="mt-1 text-sm text-sky-800">El negocio recibe tu pedido en cuanto se aprueba tu pago. Si ya pagaste, espera unos segundos.</p>
            <button
              disabled={paying}
              onClick={async () => {
                setPaying(true);
                setPayError("");
                try {
                  window.location.assign(await startOnlinePayment(placed));
                } catch (e) {
                  setPayError(e instanceof Error ? e.message : "Mercado Pago no respondió.");
                  setPaying(false);
                }
              }}
              className="mt-3 w-full rounded-xl bg-sky-500 py-3 font-black text-white disabled:opacity-60"
            >
              {paying ? "Abriendo Mercado Pago..." : "Pagar con Mercado Pago"}
            </button>
            {payError && <p className="mt-2 text-sm font-bold text-red-600">{payError}</p>}
          </div>
        )}
        {paidOnline(d) && status.status !== "rechazado" && <p className="mt-6 rounded-2xl bg-emerald-50 p-4 text-center text-sm font-bold text-emerald-800">✅ Pagaste {money(d.mp?.amount || d.total)} con Mercado Pago</p>}

        {(status.status === "listo" || status.status === "entregado") && <RateOrder placed={placed} color={color} done={status.review} />}

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
          <p className="flex justify-between"><span>Pago</span><span>{d.payment}{paidOnline(d) ? " ✅ pagado" : d.mp?.status === "refunded" ? " · devuelto" : ""}</span></p>
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
          {d.coupon && <p className="flex justify-between"><span>Cupón {d.coupon.code}</span><span>-{money(d.coupon.discount)}</span></p>}
          <p className="flex justify-between font-black"><span>TOTAL</span><span>{money(d.total)}</span></p>
          <p className="mt-3 text-center text-xs text-zinc-500">Ticket digital · bpos.com.mx</p>
        </div>

        {!customer.account && !linked && status.status !== "rechazado" && (
          <div className="mt-6 rounded-2xl border border-orange-100 bg-white p-5 text-center shadow-sm">
            <p className="font-black">Guarda tus pedidos 🧾</p>
            <p className="mt-1 text-sm text-zinc-500">Crea tu cuenta para ver tu historial y pedir otra vez con un toque.</p>
            <button onClick={() => setSignup(true)} className="mt-3 w-full rounded-xl py-3 font-black text-white" style={{ background: color }}>
              Crear mi cuenta
            </button>
          </div>
        )}
        {linked && <p className="mt-6 rounded-2xl bg-emerald-50 p-4 text-center text-sm font-bold text-emerald-800">✅ Listo: este pedido ya está en tu cuenta, en “Mis pedidos”.</p>}

        <button onClick={onBack} className="mt-6 w-full rounded-2xl border border-zinc-300 py-3 font-black">Hacer otro pedido</button>
      </div>
      {signup && (
        <AccountSheet
          slug={slug}
          color={color}
          businessName={name || slug}
          customer={customer}
          start="registro"
          prefill={{ name: d.customer.name, phone: d.customer.phone }}
          onClose={() => setSignup(false)}
          onSignedIn={(token) => {
            void customer.linkOrder(placed.id, placed.token, token).then(() => setLinked(true));
            setSignup(false);
          }}
        />
      )}
    </Shell>
  );
}
