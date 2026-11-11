"use client";
/**
 * App de meseros: bpos.com.mx/meseros/<liga>. Pensada para el celular.
 *
 *  1. Vincular: la primera vez pide el código de Configuración → Meseros y
 *     el celular queda como dispositivo del negocio (lib/waiter.ts).
 *  2. Entrar: nombre y PIN (usuarios con permiso de mesero).
 *  3. Mesas → productos → "Mandar a cocina". Precuenta desde la mesa.
 *     Sin cobro: eso es en caja.
 *  Bloqueos: sin turno (checador), comandas cortadas por el admin, fuera del
 *  horario de servicio. El admin abre una excepción con su PIN.
 */
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CartItem } from "@/components/CartPanel";
import { ComboChoiceModal } from "@/components/ComboChoiceModal";
import type { SavedOrder } from "@/components/OrderHistoryPanel";
import { ask, askText, notify } from "@/components/layout/Dialogs";
import type { Product } from "@/data/products";
import { getAdminProducts } from "@/lib/admin";
import { clearCurrentUser, getSessionUser, setCurrentUser, type CurrentUser } from "@/lib/auth";
import { loadCloudAccount, signIn } from "@/lib/cloud/account";
import { detectInitialSituation, initialSync, startSync } from "@/lib/cloud/sync";
import { buildSelection, extrasPrice, lineIdFor, needsChoices } from "@/lib/compound";
import { getDigitalMenu, isAvailableOnline, sortCategories, sortProducts } from "@/lib/digital-menu";
import { formatOrderNumber } from "@/lib/order-sequence";
import { authorizeWithAdminPin } from "@/lib/permissions";
import { askInventoryOnCancel } from "@/lib/sale-actions";
import { verifyPin } from "@/lib/pin-hash";
import { isOnSale } from "@/lib/sale-schedule";
import { getTables, openTableOrder, tableLabel, tableZones, type Table } from "@/lib/tables";
import { getUsers, type SystemUser } from "@/lib/users";
import { getBrands, isAppsOnly } from "@/lib/brands";
import { changeDiners, linkWaiterDevice, moveTable, openTableOrders, printTablePrecuenta, readWaiterDevice, readyItems, removeSentItem, reportBlockedAttempt, saveWaiterDevice, sendToKitchen, setOverride, waiterBlock, waiterDeviceSeen, waiterUsers } from "@/lib/waiter";

type Step = { kind: "loading"; text: string } | { kind: "pair" } | { kind: "login" } | { kind: "app"; user: CurrentUser };

const money = (n: number) => `$${n.toFixed(2)}`;
const lineId = (item: CartItem) => item.lineId || lineIdFor(item.id, item.parts, item.modifiers);

export default function MeserosPage() {
  const params = useParams<{ slug: string }>();
  const slug = String(params?.slug || "").toLowerCase();
  const [step, setStep] = useState<Step>({ kind: "loading", text: "Abriendo…" });

  const boot = useCallback(async () => {
    try {
      const device = readWaiterDevice();
      const account = await loadCloudAccount();
      if (account.status !== "ready" || !device) {
        setStep({ kind: "pair" });
        return;
      }
      if (device.branchId && localStorage.getItem("bpos_branch_id") !== device.branchId) localStorage.setItem("bpos_branch_id", device.branchId);
      const situation = await detectInitialSituation(account);
      if (situation !== "ready") {
        setStep({ kind: "loading", text: "Descargando el menú y las mesas…" });
        await initialSync(account, "download-cloud", (text) => setStep({ kind: "loading", text }));
      }
      startSync(account);
      const user = getSessionUser();
      setStep(user ? { kind: "app", user } : { kind: "login" });
    } catch (e) {
      notify(e instanceof Error ? e.message : "No se pudo conectar.", "error");
      setStep({ kind: "pair" });
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  if (step.kind === "loading") return <Shell><p className="py-24 text-center text-zinc-400">{step.text}</p></Shell>;
  if (step.kind === "pair") return <Shell><PairScreen slug={slug} /></Shell>;
  if (step.kind === "login") return <Shell><LoginScreen onEnter={(user) => setStep({ kind: "app", user })} /></Shell>;
  return (
    <Shell>
      <WaiterApp
        user={step.user}
        onLogout={() => {
          clearCurrentUser();
          setStep({ kind: "login" });
        }}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-lg px-4 pb-32 pt-4">{children}</div>
    </main>
  );
}

// ------------------------------------------------------------ 1. vincular

function PairScreen({ slug }: { slug: string }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const r = await linkWaiterDevice(slug, code, name);
      await signIn(r.email, r.password);
      localStorage.setItem("bpos_branch_id", r.branchId);
      saveWaiterDevice({ deviceId: r.deviceId, branchId: r.branchId, name: r.name, slug, linkedAt: new Date().toISOString() });
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo vincular.");
      setBusy(false);
    }
  }

  return (
    <div className="pt-10">
      <p className="text-center text-sm font-black uppercase tracking-widest text-orange-500">B-POS · Meseros</p>
      <h1 className="mt-2 text-center text-3xl font-black">Vincular este celular</h1>
      <p className="mt-3 text-center text-sm text-zinc-400">Pide en caja el código de Configuración → Meseros. Solo se hace una vez.</p>
      <label className="mt-8 block text-sm font-bold text-zinc-400">¿De quién es este celular?</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Celular de Ana" className="mt-2 w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-4 text-lg" />
      <label className="mt-5 block text-sm font-bold text-zinc-400">Código de 6 dígitos</label>
      <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="000000" className="mt-2 w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-4 text-center font-mono text-3xl tracking-[0.4em]" />
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <button onClick={() => void submit()} disabled={busy || code.length !== 6} className="mt-6 w-full rounded-2xl bg-orange-500 py-4 text-lg font-black text-black disabled:opacity-50">
        {busy ? "Vinculando…" : "Vincular"}
      </button>
    </div>
  );
}

// ------------------------------------------------------------ 2. entrar

function LoginScreen({ onEnter }: { onEnter: (user: CurrentUser) => void }) {
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [selected, setSelected] = useState<SystemUser | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const load = () => setUsers(waiterUsers());
    load();
    window.addEventListener("bpos:users-updated", load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener("bpos:users-updated", load);
      window.removeEventListener("storage", load);
    };
  }, []);

  async function confirm() {
    if (!selected) return;
    const user = getUsers().find((u) => u.id === selected.id) || selected;
    if (!(await verifyPin(pin, user))) {
      setError("PIN incorrecto.");
      setPin("");
      return;
    }
    const current = { id: user.id, name: user.name, role: user.role };
    setCurrentUser(current);
    onEnter(current);
  }

  if (!selected) {
    return (
      <div className="pt-8">
        <p className="text-center text-sm font-black uppercase tracking-widest text-orange-500">B-POS · Meseros</p>
        <h1 className="mt-2 text-center text-3xl font-black">¿Quién eres?</h1>
        {users.length === 0 && <p className="mt-6 text-center text-sm text-zinc-400">Todavía no hay meseros dados de alta. En la caja: Configuración → Usuarios, rol Mesero.</p>}
        <div className="mt-6 grid grid-cols-2 gap-3">
          {users.map((u) => (
            <button key={u.id} onClick={() => setSelected(u)} className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-6 text-lg font-black">
              {u.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="pt-8">
      <button onClick={() => { setSelected(null); setPin(""); setError(""); }} className="text-sm font-black text-zinc-400">← Otro mesero</button>
      <h1 className="mt-4 text-center text-2xl font-black">{selected.name}</h1>
      <p className="mt-6 text-center font-mono text-4xl tracking-[0.5em]">{"•".repeat(pin.length) || " "}</p>
      {error && <p className="mt-2 text-center text-sm text-red-400">{error}</p>}
      <div className="mt-6 grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"].map((k) => (
          <button
            key={k}
            onClick={() => {
              if (k === "⌫") setPin((p) => p.slice(0, -1));
              else if (k === "OK") void confirm();
              else if (pin.length < 8) setPin((p) => p + k);
              setError("");
            }}
            className={`h-16 rounded-2xl text-2xl font-black ${k === "OK" ? "bg-orange-500 text-black" : "border border-zinc-800 bg-zinc-950"}`}
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ 3. mesas y comandas

function WaiterApp({ user, onLogout }: { user: CurrentUser; onLogout: () => void }) {
  const [tables, setTables] = useState<Table[]>([]);
  const [orders, setOrders] = useState<SavedOrder[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [zone, setZone] = useState("");
  const [mine, setMine] = useState(false);
  const [table, setTable] = useState<Table | null>(null);
  const [diners, setDiners] = useState(2);
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [choosing, setChoosing] = useState<Product | null>(null);
  const [moving, setMoving] = useState(false);
  const [sending, setSending] = useState(false);
  const [tick, setTick] = useState(0);
  const readySeen = useRef<Record<number, string>>({});

  useEffect(() => {
    const load = () => {
      setTables(getTables().filter((t) => t.active));
      setOrders(openTableOrders());
      setProducts(getAdminProducts());
      setTick((n) => n + 1);
    };
    load();
    const events = ["bpos:orders-updated", "bpos:tables-updated", "bpos:products-updated", "bpos:timeclock-updated", "bpos:users-updated", "storage", "focus"];
    events.forEach((e) => window.addEventListener(e, load));
    const timer = setInterval(load, 20_000);
    // "Última vez" del celular en Configuración → Meseros
    void waiterDeviceSeen();
    const seen = setInterval(() => void waiterDeviceSeen(), 5 * 60_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, load));
      clearInterval(timer);
      clearInterval(seen);
    };
  }, []);

  // Cocina marcó listo algo de una mesa de este mesero: aviso y vibración
  useEffect(() => {
    for (const o of orders) {
      if (o.details.waiter && o.details.waiter !== user.name) continue;
      const ready = readyItems(o);
      const key = ready.join("|");
      if (!key) continue;
      if (readySeen.current[o.id] === undefined) {
        readySeen.current[o.id] = key; // lo que ya estaba listo al abrir no se avisa
        continue;
      }
      if (readySeen.current[o.id] === key) continue;
      readySeen.current[o.id] = key;
      notify(`🍽️ ${tableLabel(o.details.table)}: listo para llevar · ${ready.slice(-3).join(", ")}`);
      try {
        navigator.vibrate?.([200, 100, 200]);
      } catch {
        // sin vibración
      }
    }
  }, [orders, user.name]);

  const me = useMemo(() => getUsers().find((u) => u.id === user.id) || { id: user.id, name: user.name, waiterAccess: undefined }, [user, tick]); // eslint-disable-line react-hooks/exhaustive-deps -- tick: recarga al cambiar usuarios o checador
  const block = useMemo(() => waiterBlock(me), [me, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const zones = useMemo(() => tableZones(tables), [tables]);
  const menu = useMemo(() => getDigitalMenu(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  // Sin lo de una marca que solo vende en apps (Configuración → Marcas)
  const available = useMemo(() => {
    const brands = getBrands();
    return sortProducts(products.filter((p) => isAvailableOnline(menu, p) && isOnSale(p.saleSchedule) && !isAppsOnly(p, brands)), menu.categoryOrder, menu.productOrder);
  }, [products, menu]);
  const categories = useMemo(() => sortCategories(Array.from(new Set(available.map((p) => p.category))), menu.categoryOrder), [available, menu]);
  const open = table ? openTableOrder(orders, table.id) : undefined;
  const cartTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const isMine = (o: SavedOrder | undefined) => Boolean(o && o.details.waiter === user.name);

  function addLine(product: Product, sel: Pick<CartItem, "parts" | "modifiers" | "ownTicket" | "comment" | "extraStations">) {
    const id = lineIdFor(product.id, sel.parts, sel.modifiers) + (sel.comment ? `|c:${sel.comment}` : "");
    const price = product.price + extrasPrice(sel.modifiers, sel.parts);
    setCart((c) => {
      const found = c.find((i) => lineId(i) === id);
      if (found) return c.map((i) => (lineId(i) === id ? { ...i, quantity: i.quantity + 1 } : i));
      return [...c, { ...product, price, quantity: 1, lineId: id, ...(sel.parts?.length ? { parts: sel.parts, ownTicket: sel.ownTicket } : {}), ...(sel.modifiers?.length ? { modifiers: sel.modifiers } : {}), ...(sel.comment ? { comment: sel.comment } : {}), ...(sel.extraStations?.length ? { extraStations: sel.extraStations } : {}) }];
    });
  }
  function add(product: Product) {
    if (needsChoices(product, products)) setChoosing(product);
    else addLine(product, buildSelection(product, products));
  }
  function changeQty(id: string, delta: number) {
    setCart((c) => c.map((i) => (lineId(i) === id ? { ...i, quantity: i.quantity + delta } : i)).filter((i) => i.quantity > 0));
  }
  /** Nota para cocina en un renglón ("sin cebolla"); con otra nota es otro renglón */
  async function noteLine(id: string) {
    const item = cart.find((i) => lineId(i) === id);
    if (!item) return;
    const text = await askText(`Nota para cocina · ${item.name}`, { placeholder: "Ej. sin cebolla, término medio", defaultValue: item.comment || "", ok: "Guardar" });
    if (text === null) return;
    const comment = text.trim();
    setCart((c) => {
      const base = (item.lineId || "").replace(/\|c:.*$/, "") || lineIdFor(item.id, item.parts, item.modifiers);
      const nextId = base + (comment ? `|c:${comment}` : "");
      const rest = c.filter((i) => lineId(i) !== id);
      const same = rest.find((i) => lineId(i) === nextId);
      const moved = { ...item, lineId: nextId, ...(comment ? { comment } : {}) } as CartItem;
      if (!comment) delete moved.comment;
      if (same) return rest.map((i) => (lineId(i) === nextId ? { ...i, quantity: i.quantity + item.quantity } : i));
      return [...rest, moved];
    });
  }

  async function allowOrExplain(): Promise<boolean> {
    if (!block) return true;
    reportBlockedAttempt(user, block, table || undefined);
    notify(block.message, "error");
    if (await authorizeWithAdminPin(block.kind === "horario" ? "mandar comandas fuera del horario de servicio" : "mandar comandas sin estar en turno", user)) {
      setOverride();
      setTick((n) => n + 1);
      return true;
    }
    return false;
  }

  async function send() {
    if (!table || cart.length === 0 || sending) return;
    if (!(await allowOrExplain())) return;
    setSending(true);
    try {
      const r = await sendToKitchen(cart, table, open?.details.diners || diners, user);
      setCart([]);
      setOrders(openTableOrders());
      if (r.failed.length) notify(`Mandado, pero no salió en: ${r.failed.join(" · ")}. Avisa en caja.`, "error");
      else notify(`${tableLabel(table)} · ronda ${r.round} mandada a cocina (#${formatOrderNumber(r.order as SavedOrder & { localOrderNumber?: number })}).`);
      setTable(null);
    } catch (e) {
      notify(e instanceof Error ? e.message : "No se pudo mandar.", "error");
    } finally {
      setSending(false);
    }
  }

  async function precuenta() {
    if (!open) return;
    const persons = open.details.diners && open.details.diners > 1 ? await askText("¿Dividir entre cuántas personas? (vacío: sin dividir)", { numeric: true, placeholder: String(open.details.diners), ok: "Imprimir" }) : "";
    if (persons === null) return;
    const split = Math.max(0, Math.min(50, Number(persons) || 0));
    try {
      const failed = await printTablePrecuenta(open, user, split);
      if (failed.length) notify(`No salió la precuenta: ${failed.join(" · ")}`, "error");
      else notify(split > 1 ? `Precuenta impresa en caja, dividida entre ${split}.` : "Precuenta impresa en caja.");
    } catch {
      notify("No se pudo imprimir la precuenta. Avisa en caja.", "error");
    }
  }

  async function editDiners() {
    if (!open) return;
    const v = await askText("¿Cuántas personas?", { numeric: true, defaultValue: String(open.details.diners || 2), ok: "Cambiar" });
    const n = Number(v);
    if (!v || !Number.isFinite(n) || n < 1 || n > 99) return;
    changeDiners(open, Math.round(n), user);
    setOrders(openTableOrders());
  }

  function doMove(to: Table) {
    if (!open) return;
    try {
      moveTable(open, to, user);
      setOrders(openTableOrders());
      setMoving(false);
      setTable(to);
      notify(`Cuenta pasada a ${tableLabel(to)}.`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "No se pudo mover.", "error");
    }
  }

  async function removeItem(index: number) {
    if (!open) return;
    const item = open.items[index];
    if (!(await ask(`¿Quitar ${item.quantity}x ${item.name} de la cuenta? Lo autoriza un administrador con su PIN.`, { ok: "Quitar" }))) return;
    if (!(await authorizeWithAdminPin(`quitar ${item.name} de ${tableLabel(open.details.table)}`, user))) return;
    const stock = await askInventoryOnCancel(open);
    if (stock === null) return;
    const updated = removeSentItem(open, index, "Admin", user, stock);
    setOrders(openTableOrders());
    if (updated?.cancelled) {
      notify("La cuenta quedó vacía y se canceló.");
      setTable(null);
    } else notify(`${item.name} quitado de la cuenta.`);
  }

  const header = (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-xs font-black uppercase tracking-widest text-orange-500">Meseros</p>
        <p className="text-lg font-black">{user.name}</p>
      </div>
      <button onClick={onLogout} className="rounded-xl border border-zinc-800 px-3 py-2 text-xs font-black text-zinc-300">Salir</button>
    </div>
  );
  const banner = block ? (
    <div className="mt-3 rounded-2xl border border-red-500/40 bg-red-950/60 px-4 py-3 text-sm font-bold text-red-100">{block.message}</div>
  ) : null;

  // --- lista de mesas (las mías primero)
  if (!table) {
    const shown = tables
      .filter((t) => !zone || t.zone === zone)
      .filter((t) => !mine || isMine(openTableOrder(orders, t.id)))
      .sort((a, b) => Number(isMine(openTableOrder(orders, b.id))) - Number(isMine(openTableOrder(orders, a.id))));
    return (
      <div>
        {header}
        {banner}
        <div className="mt-4 flex gap-2 overflow-x-auto">
          <button onClick={() => setMine((m) => !m)} className={`shrink-0 rounded-xl px-3 py-2 text-sm font-black ${mine ? "bg-orange-500 text-black" : "border border-zinc-800 text-zinc-300"}`}>Mis mesas</button>
          {zones.length > 1 &&
            ["", ...zones].map((z) => (
              <button key={z || "todas"} onClick={() => setZone(z)} className={`shrink-0 rounded-xl px-3 py-2 text-sm font-black ${zone === z ? "bg-orange-500 text-black" : "border border-zinc-800 text-zinc-300"}`}>
                {z || "Todas"}
              </button>
            ))}
        </div>
        {tables.length === 0 && <p className="mt-8 text-center text-sm text-zinc-400">No hay mesas. En la caja: Configuración → Mesas.</p>}
        {tables.length > 0 && shown.length === 0 && <p className="mt-8 text-center text-sm text-zinc-400">No tienes mesas abiertas.</p>}
        <div className="mt-4 grid grid-cols-3 gap-3">
          {shown.map((t) => {
            const o = openTableOrder(orders, t.id);
            const ready = o ? readyItems(o).length : 0;
            return (
              <button key={t.id} onClick={() => { setTable(t); setCategory(""); setQuery(""); setCart([]); }} className={`relative rounded-2xl border p-3 text-left ${o ? (isMine(o) ? "border-orange-500 bg-orange-500/15" : "border-zinc-600 bg-zinc-900") : "border-zinc-800 bg-zinc-950"}`}>
                <p className="text-xl font-black">{t.name}</p>
                <p className="text-[11px] text-zinc-500">{t.zone}</p>
                <p className={`mt-2 text-sm font-black ${o ? "text-orange-300" : "text-green-400"}`}>{o ? money(o.total) : "Libre"}</p>
                {o?.details.waiter && !isMine(o) && <p className="truncate text-[10px] text-zinc-500">{o.details.waiter}</p>}
                {ready > 0 && <span className="absolute right-2 top-2 rounded-full bg-green-500 px-1.5 text-[10px] font-black text-black">🍽️</span>}
              </button>
            );
          })}
        </div>
        <p className="mt-6 text-center text-[11px] text-zinc-600">Agrega esta página a tu pantalla de inicio para abrirla como app.</p>
      </div>
    );
  }

  // --- una mesa
  const q = query.trim().toLowerCase();
  const list = available.filter((p) => (!category || p.category === category) && (!q || p.name.toLowerCase().includes(q)));
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <button onClick={() => { setTable(null); setCart([]); setMoving(false); }} className="rounded-xl border border-zinc-800 px-3 py-2 text-sm font-black">← Mesas</button>
        <p className="text-lg font-black">{tableLabel(table, open?.details.diners || undefined)}</p>
        <button onClick={onLogout} className="text-xs font-black text-zinc-500">Salir</button>
      </div>
      {banner}

      {open ? (
        <div className="mt-4 rounded-2xl border border-orange-500/40 bg-zinc-950 p-4">
          <div className="flex items-center justify-between">
            <p className="font-black text-orange-300">Cuenta abierta · #{formatOrderNumber(open as SavedOrder & { localOrderNumber?: number })}</p>
            <p className="font-black">{money(open.total)}</p>
          </div>
          {open.details.waiter && <p className="text-xs text-zinc-500">Mesero: {open.details.waiter}</p>}
          <ul className="mt-2 space-y-1 text-sm text-zinc-300">
            {open.items.map((i, idx) => {
              const done = (i as { kdsDone?: boolean }).kdsDone || (open as SavedOrder & { kdsCompleted?: boolean }).kdsCompleted;
              return (
                <li key={idx} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1">
                    {done ? "✅ " : ""}{i.quantity} × {i.name}{i.comment ? <span className="text-zinc-500"> · {i.comment}</span> : null}
                  </span>
                  <span className="text-xs text-zinc-500">r{i.round || 1}</span>
                  <button onClick={() => void removeItem(idx)} aria-label={`Quitar ${i.name}`} className="h-7 w-7 rounded-lg border border-zinc-700 text-xs font-black text-red-300">✕</button>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button onClick={() => void precuenta()} className="rounded-xl border border-zinc-700 py-2 text-sm font-black">🧾 Precuenta</button>
            <button onClick={() => void editDiners()} className="rounded-xl border border-zinc-700 py-2 text-sm font-black">👥 Personas</button>
            <button onClick={() => setMoving((m) => !m)} className="rounded-xl border border-zinc-700 py-2 text-sm font-black">{moving ? "Cancelar" : "↔️ Mover"}</button>
          </div>
          {moving && (
            <div className="mt-3">
              <p className="text-xs font-bold text-zinc-400">Pasar la cuenta a:</p>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {tables.filter((t) => t.id !== table.id && !openTableOrder(orders, t.id)).map((t) => (
                  <button key={t.id} onClick={() => doMove(t)} className="rounded-xl border border-zinc-800 bg-black py-2 text-sm font-black">{t.name}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
          <p className="text-sm font-bold text-zinc-400">¿Cuántas personas?</p>
          <div className="mt-2 flex gap-2 overflow-x-auto">
            {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
              <button key={n} onClick={() => setDiners(n)} className={`h-11 w-11 shrink-0 rounded-xl font-black ${diners === n ? "bg-orange-500 text-black" : "border border-zinc-800"}`}>{n}</button>
            ))}
          </div>
        </div>
      )}

      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 Buscar platillo" className="mt-4 w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3" />
      <div className="mt-3 flex gap-2 overflow-x-auto">
        {["", ...categories].map((c) => (
          <button key={c || "todo"} onClick={() => setCategory(c)} className={`shrink-0 rounded-xl px-3 py-2 text-sm font-black ${category === c ? "bg-orange-500 text-black" : "border border-zinc-800 text-zinc-300"}`}>
            {c || "Todo"}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {list.map((p) => {
          const inCart = cart.filter((i) => i.id === p.id).reduce((s, i) => s + i.quantity, 0);
          return (
            <button key={p.id} onClick={() => add(p)} className={`rounded-2xl border p-3 text-left ${inCart ? "border-orange-500 bg-orange-500/10" : "border-zinc-800 bg-zinc-950"}`}>
              <p className="text-sm font-black leading-tight">{p.emoji ? `${p.emoji} ` : ""}{p.name}</p>
              <p className="mt-1 text-xs text-zinc-400">{money(p.price)}{inCart ? ` · ${inCart} en la orden` : ""}</p>
            </button>
          );
        })}
        {list.length === 0 && <p className="col-span-2 py-6 text-center text-sm text-zinc-500">Nada con ese nombre.</p>}
      </div>

      {choosing && (
        <ComboChoiceModal
          product={choosing}
          products={products}
          onConfirm={(sel) => {
            addLine(choosing, sel);
            setChoosing(null);
          }}
          onClose={() => setChoosing(null)}
        />
      )}

      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800 bg-black/95 p-4 backdrop-blur">
          <div className="mx-auto max-w-lg">
            <ul className="max-h-44 space-y-1 overflow-auto text-sm">
              {cart.map((i) => {
                const id = lineId(i);
                return (
                  <li key={id} className="flex items-center justify-between gap-2">
                    <button onClick={() => void noteLine(id)} className="min-w-0 flex-1 truncate text-left" title="Nota para cocina">
                      {i.name}
                      <span className="text-zinc-500">{i.comment ? ` · ${i.comment}` : " · 📝"}</span>
                    </button>
                    <div className="flex items-center gap-2">
                      <button onClick={() => changeQty(id, -1)} className="h-8 w-8 rounded-lg border border-zinc-700 font-black">−</button>
                      <span className="w-5 text-center font-black">{i.quantity}</span>
                      <button onClick={() => changeQty(id, 1)} className="h-8 w-8 rounded-lg border border-zinc-700 font-black">+</button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <button onClick={() => void send()} disabled={sending} className="mt-3 w-full rounded-2xl bg-orange-500 py-4 text-lg font-black text-black disabled:opacity-50">
              {sending ? "Mandando…" : `🍳 Mandar a cocina · ${money(cartTotal)}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
