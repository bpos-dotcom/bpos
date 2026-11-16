"use client";
/**
 * Personal: la cena del personal. Como el POS (mismos productos, opciones y
 * combos) pero sin cobro: se elige el nombre y "Marcar cena". Va a las
 * estaciones como un pedido, descuenta inventario, imprime un comprobante
 * corto y avisa al dueño. Se configura en Configuración → Cena del personal.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { ask, notify } from "@/components/layout/Dialogs";
import { ComboChoiceModal } from "@/components/ComboChoiceModal";
import { ProductCard } from "@/components/ProductCard";
import { cartLineId, type CartItem } from "@/components/CartPanel";
import type { Product } from "@/data/products";
import { getAdminProducts } from "@/lib/admin";
import { addAuditEvent } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { printSale, saleStations } from "@/lib/bridge/sale-tickets";
import { BRANDS_EVENT, getBrands, isAppsOnly, type Brand } from "@/lib/brands";
import { buildSelection, extrasPrice, lineIdFor, needsChoices } from "@/lib/compound";
import { categoryOffMenu, getDigitalMenu, sortCategories, sortProducts } from "@/lib/digital-menu";
import { applyInventoryForOrder, latestUnitCost, revertInventoryForOrder } from "@/lib/inventory";
import { notifyKdsUpdated } from "@/lib/kds";
import { allocateShiftOrderNumber, formatOrderNumber } from "@/lib/order-sequence";
import { authorizeAdmin } from "@/lib/permissions";
import { isOnSale, scheduleLabel } from "@/lib/sale-schedule";
import {
  STAFF_MEAL_EVENT,
  buildStaffMealOrder,
  capProblem,
  getStaffMealConfig,
  itemsText,
  personStatus,
  productAllowed,
  withoutPaidExtras,
  undoStaffMeal,
  type StaffMealConfig,
  type StaffMealInfo,
  type StaffPerson,
} from "@/lib/staff-meals";

const ORDERS_KEY = "bpos_orders";
type MealOrder = ReturnType<typeof buildStaffMealOrder<CartItem>> & { cancelled?: boolean; localOrderNumber?: number; staffMeal: StaffMealInfo };
type AnyOrder = { id: number; createdAt: string; cancelled?: boolean; staffMeal?: StaffMealInfo; [k: string]: unknown };

const readOrders = (): AnyOrder[] => {
  try {
    const list = JSON.parse(localStorage.getItem(ORDERS_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};
const writeOrders = (list: AnyOrder[]) => {
  localStorage.setItem(ORDERS_KEY, JSON.stringify(list));
  window.dispatchEvent(new Event("bpos:orders-updated"));
};
const hour = (iso: string) => new Date(iso).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });
const round2 = (n: number) => Math.round(n * 100) / 100;

export default function PersonalPage() {
  const [config, setConfig] = useState<StaffMealConfig | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [orders, setOrders] = useState<AnyOrder[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [personId, setPersonId] = useState("");
  const [category, setCategory] = useState("Todos");
  const [search, setSearch] = useState("");
  const [choosing, setChoosing] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    const loadConfig = () => setConfig(getStaffMealConfig());
    const loadOrders = () => setOrders(readOrders());
    const loadBrands = () => setBrands(getBrands());
    // Sin extras con costo: la cena es lo del menú tal cual
    const loadProducts = () => setProducts(getAdminProducts().map((p) => withoutPaidExtras({ ...p, station: p.station || "Cocina" })));
    loadConfig();
    loadOrders();
    loadBrands();
    loadProducts();
    window.addEventListener(STAFF_MEAL_EVENT, loadConfig);
    window.addEventListener("bpos:orders-updated", loadOrders);
    window.addEventListener("storage", loadOrders);
    window.addEventListener(BRANDS_EVENT, loadBrands);
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => {
      window.removeEventListener(STAFF_MEAL_EVENT, loadConfig);
      window.removeEventListener("bpos:orders-updated", loadOrders);
      window.removeEventListener("storage", loadOrders);
      window.removeEventListener(BRANDS_EVENT, loadBrands);
      window.clearInterval(timer);
    };
  }, []);

  const menu = useMemo(() => getDigitalMenu(), []);
  const allowed = useMemo(() => {
    if (!config) return [];
    return sortProducts(
      products.filter((p) => !p.notSoldAlone && !isAppsOnly(p, brands) && productAllowed(p, config)),
      menu.categoryOrder,
      menu.productOrder
    );
  }, [products, brands, config, menu]);
  const categories = useMemo(() => ["Todos", ...sortCategories(Array.from(new Set(allowed.map((p) => p.category).filter(Boolean))), menu.categoryOrder)], [allowed, menu]);
  const shown = allowed.filter((p) => (category === "Todos" || p.category === category) && (!search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase())));
  const offSchedule = useCallback(
    (p: Product) => {
      const now = new Date(clock);
      if (!isOnSale(p.saleSchedule, now)) return scheduleLabel(p.saleSchedule);
      return categoryOffMenu(menu, p.category, now);
    },
    [clock, menu]
  );

  if (!config) return null;
  const now = new Date(clock);
  const statusOf = (p: StaffPerson) => personStatus(p, orders, config, now);
  const person = config.people.find((p) => p.id === personId);
  const personOk = person ? statusOf(person).kind === "ok" : false;
  const cap = capProblem(cart, config);
  const pieces = cart.reduce((n, i) => n + i.quantity, 0);

  function add(product: Product) {
    const off = offSchedule(product);
    if (off) return notify(`${product.name} solo se vende: ${off}.`, "error");
    if (needsChoices(product, products)) return setChoosing(product);
    addLine(product, buildSelection(product, products));
  }

  function addLine(product: Product, { parts, modifiers, ownTicket, comment, extraStations }: Pick<CartItem, "parts" | "modifiers" | "ownTicket" | "comment" | "extraStations">) {
    const lineId = lineIdFor(product.id, parts, modifiers) + (comment ? `|c:${comment}` : "");
    const price = product.price + extrasPrice(modifiers, parts);
    setCart((current) =>
      current.some((i) => cartLineId(i) === lineId)
        ? current.map((i) => (cartLineId(i) === lineId ? { ...i, quantity: i.quantity + 1 } : i))
        : [...current, { ...product, price, quantity: 1, lineId, ...(parts?.length ? { parts, ownTicket } : {}), ...(modifiers?.length ? { modifiers } : {}), ...(comment ? { comment } : {}), ...(extraStations?.length ? { extraStations } : {}) }]
    );
  }

  const changeQty = (lineId: string, delta: number) =>
    setCart((current) => current.map((i) => (cartLineId(i) === lineId ? { ...i, quantity: i.quantity + delta } : i)).filter((i) => i.quantity > 0));

  async function markMeal() {
    if (!person || !config) return;
    const fresh = readOrders();
    const status = personStatus(person, fresh, config, new Date());
    if (status.kind !== "ok") {
      setOrders(fresh);
      return notify(status.kind === "used" ? `${person.name} ya usó su cena de hoy.` : `${person.name}: ${status.reason}.`, "error");
    }
    if (!cart.length) return notify("Elige lo que va a cenar.", "error");
    if (cap) return notify(cap, "error");
    setBusy(true);
    try {
      const by = getCurrentUser()?.name || "";
      let sequence: { localOrderNumber: number; shiftSessionId: string } | null = null;
      try {
        sequence = allocateShiftOrderNumber();
      } catch {
        // caja cerrada: la cena va sin folio del turno
      }
      const id = fresh.reduce((max, o) => Math.max(max, Number(o.id) || 0), 0) + 1;
      const order = buildStaffMealOrder({ id, person, items: cart, by, sequence }) as MealOrder;
      writeOrders([...fresh, order as unknown as AnyOrder]);
      // Inventario (con sus recetas, como una venta) y lo que costó en insumos
      const applied = applyInventoryForOrder({ id, items: cart, source: "POS", staffMeal: { name: person.name } });
      const cost = round2(applied.movements.reduce((s, m) => s + latestUnitCost(Number(m.ingredientId)) * Number(m.quantity), 0));
      const saved: MealOrder = { ...order, staffMeal: { ...order.staffMeal, cost } };
      writeOrders(readOrders().map((o) => (o.id === id ? (saved as unknown as AnyOrder) : o)));
      setOrders(readOrders());
      notifyKdsUpdated(id);
      const what = itemsText(cart);
      addAuditEvent({
        category: "Personal",
        action: "staff_meal.created",
        description: `${person.name} marcó su cena: ${what}${cost ? ` · costo $${cost.toFixed(2)}` : ""}${by && by !== person.name ? ` (lo marcó ${by})` : ""}`,
        userName: by || undefined,
        entityId: String(id),
        metadata: { name: person.name, cost, items: pieces },
      });
      // Comandas a sus estaciones y el comprobante corto en Caja
      void printSale(saved, { stations: saleStations(saved), customer: true, drawer: false }, false)
        .then((failed) => {
          if (failed.length) notify(`Cena marcada, pero no salió en: ${failed.join(" · ")}. Reimprime desde Historial de pedidos.`, "error");
        })
        .catch(() => notify("Cena marcada, pero B-POS no pudo imprimir. Revisa que B-POS Agent esté conectado.", "error"));
      notify(`🍽️ Cena de ${person.name} marcada${sequence ? ` (Pedido #${formatOrderNumber(saved)})` : ""}. Ya va a cocina.`);
      setCart([]);
      setPersonId("");
    } finally {
      setBusy(false);
    }
  }

  async function undo(p: StaffPerson, order: AnyOrder) {
    const admin = await authorizeAdmin(`deshacer la cena de ${p.name}`, getCurrentUser());
    if (!admin) return;
    const prepared = await ask(`¿Ya se había preparado la cena de ${p.name}?`, { ok: "Sí · se tira (merma)", cancel: "No · regresa al inventario" });
    const reason = "Cena marcada por error";
    const fresh = readOrders();
    const current = fresh.find((o) => o.id === order.id);
    if (!current || current.cancelled) return setOrders(fresh);
    const undone = undoStaffMeal(current, reason, admin);
    writeOrders(fresh.map((o) => (o.id === order.id ? undone : o)));
    setOrders(readOrders());
    revertInventoryForOrder({ id: order.id, items: (current.items as CartItem[]) || [], staffMeal: { name: p.name } }, prepared ? "merma" : "regresar", reason);
    notifyKdsUpdated(order.id);
    addAuditEvent({
      category: "Personal",
      action: "staff_meal.cancelled",
      description: `${admin} deshizo la cena de ${p.name} (${prepared ? "ya preparada: merma" : "regresó al inventario"})`,
      userName: admin,
      entityId: String(order.id),
      metadata: { name: p.name },
    });
    notify(`Cena de ${p.name} deshecha. Ya puede volver a marcar.`);
  }

  if (!config.enabled) {
    return (
      <AppShell title="Personal" subtitle="La cena del personal.">
        <div className="max-w-xl rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
          <p className="text-xl font-black text-orange-500">🍽️ La cena del personal está apagada</p>
          <p className="mt-2 text-sm text-zinc-400">Actívala y di quiénes tienen cena, qué días y qué pueden elegir.</p>
          <Link href="/configuracion/personal" className="mt-4 inline-block rounded-2xl bg-orange-500 px-5 py-3 font-black text-black">
            Configurar cena del personal
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Personal" subtitle="Elige quién cena y qué: va a cocina, descuenta inventario y avisa al dueño.">
      {choosing && (
        <ComboChoiceModal
          product={choosing}
          products={products}
          hidePrices
          onClose={() => setChoosing(null)}
          onConfirm={(chosen) => {
            addLine(choosing, chosen);
            setChoosing(null);
          }}
        />
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
        {/* Productos */}
        <section className="min-w-0 rounded-3xl border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
          <h2 className="text-xl font-black">PRODUCTOS</h2>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar producto..." className="mt-3 w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white placeholder:text-zinc-600" />
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`shrink-0 rounded-2xl border px-4 py-2 text-sm font-bold ${category === cat ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-800 bg-black text-zinc-300 hover:border-orange-500"}`}
              >
                {cat}
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-3">
            {shown.map((p) => (
              <ProductCard key={p.id} product={p} nameOnly onAdd={add} offSchedule={offSchedule(p)} inCart={cart.reduce((n, i) => (i.id === p.id ? n + i.quantity : n), 0)} />
            ))}
            {shown.length === 0 && <p className="col-span-full py-6 text-center text-sm text-zinc-500">No hay productos para la cena con ese filtro.</p>}
          </div>
        </section>

        {/* Personal y la cena */}
        <section className="flex min-w-0 flex-col gap-4">
          <div className="rounded-3xl border border-orange-500/50 bg-orange-500/5 p-4 sm:p-5">
            <p className="text-2xl font-black text-orange-400">🍽️ Personal</p>
            <p className="mt-1 text-sm text-zinc-400">Elige quién va a cenar. Una cena por persona al día.</p>
            <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
              {config.people.map((p) => {
                const s = statusOf(p);
                const selected = p.id === personId;
                return (
                  <li key={p.id}>
                    <div
                      className={`flex items-center gap-2 rounded-2xl border p-3 ${
                        s.kind !== "ok" ? "border-zinc-800 bg-zinc-900/60 text-zinc-500" : selected ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-700 bg-black text-white"
                      }`}
                    >
                      <button type="button" disabled={s.kind !== "ok"} onClick={() => setPersonId(selected ? "" : p.id)} className="min-w-0 flex-1 text-left disabled:cursor-not-allowed">
                        <span className="block break-words font-black">{p.name}</span>
                        <span className={`block text-xs font-bold ${selected ? "text-black/70" : ""}`}>
                          {s.kind === "ok" ? (selected ? "✓ Seleccionado" : "Disponible") : s.kind === "used" ? `Ya usó su cena de hoy · ${hour(s.at)}` : s.reason}
                        </span>
                      </button>
                      {s.kind === "used" && (
                        <button type="button" onClick={() => void undo(p, s.order as AnyOrder)} className="shrink-0 rounded-xl border border-zinc-700 px-2 py-1 text-xs font-black text-zinc-400 hover:text-white">
                          Deshacer
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
              {config.people.length === 0 && (
                <li className="text-sm text-zinc-500">
                  No hay nadie en la lista. Agrégalos en{" "}
                  <Link href="/configuracion/personal" className="font-black text-orange-300 underline">
                    Configuración → Cena del personal
                  </Link>
                  .
                </li>
              )}
            </ul>
          </div>

          <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
            <p className="text-xl font-black text-orange-500">🛒 Su cena</p>
            <ul className="mt-3 space-y-2">
              {cart.map((i) => (
                <li key={cartLineId(i)} className="rounded-2xl border border-zinc-800 bg-black p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="break-words font-black">
                        {i.quantity} × {i.name}
                      </p>
                      {[...(i.parts || []).map((x) => x.name), ...(i.modifiers || []).map((m) => m.name), i.comment].filter(Boolean).length > 0 && (
                        <p className="break-words text-xs text-zinc-500">{[...(i.parts || []).map((x) => x.name), ...(i.modifiers || []).map((m) => m.name), i.comment].filter(Boolean).join(" · ")}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button type="button" onClick={() => changeQty(cartLineId(i), -1)} className="h-9 w-9 rounded-xl border border-zinc-700 font-black">
                        −
                      </button>
                      <button type="button" onClick={() => changeQty(cartLineId(i), 1)} className="h-9 w-9 rounded-xl bg-orange-500 font-black text-black">
                        +
                      </button>
                    </div>
                  </div>
                </li>
              ))}
              {cart.length === 0 && <li className="rounded-2xl border border-dashed border-zinc-800 p-4 text-center text-sm text-zinc-500">Toca los productos para agregarlos</li>}
            </ul>
            {(config.maxItems > 0 || cap) && (
              <p className={`mt-3 text-xs font-bold ${cap ? "text-yellow-200" : "text-zinc-500"}`}>
                {cap || `Tope: ${config.maxItems} ${config.maxItems === 1 ? "producto" : "productos"} (lleva ${pieces})`}
              </p>
            )}
            <button
              type="button"
              disabled={busy || !personOk || !cart.length || Boolean(cap)}
              onClick={() => void markMeal()}
              className="mt-4 w-full rounded-2xl bg-orange-500 py-4 text-lg font-black text-black disabled:opacity-40"
            >
              {busy ? "Marcando..." : person ? `🍽️ Marcar cena de ${person.name}` : "🍽️ Marcar cena"}
            </button>
            {!person && <p className="mt-2 text-center text-xs text-zinc-500">Primero elige quién va a cenar.</p>}
            {cart.length > 0 && (
              <button type="button" onClick={() => setCart([])} className="mt-2 w-full rounded-2xl border border-zinc-800 py-2 text-sm font-black text-zinc-400">
                Vaciar
              </button>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
