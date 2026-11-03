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
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CartItem } from "@/components/CartPanel";
import { ComboChoiceModal } from "@/components/ComboChoiceModal";
import type { SavedOrder } from "@/components/OrderHistoryPanel";
import { notify } from "@/components/layout/Dialogs";
import type { Product } from "@/data/products";
import { getAdminProducts } from "@/lib/admin";
import { clearCurrentUser, getSessionUser, setCurrentUser, type CurrentUser } from "@/lib/auth";
import { loadCloudAccount, signIn } from "@/lib/cloud/account";
import { detectInitialSituation, initialSync, startSync } from "@/lib/cloud/sync";
import { buildSelection, extrasPrice, lineIdFor, needsChoices } from "@/lib/compound";
import { getDigitalMenu, isAvailableOnline, sortCategories } from "@/lib/digital-menu";
import { formatOrderNumber } from "@/lib/order-sequence";
import { authorizeWithAdminPin } from "@/lib/permissions";
import { verifyPin } from "@/lib/pin-hash";
import { isOnSale } from "@/lib/sale-schedule";
import { getTables, openTableOrder, tableLabel, tableZones, type Table } from "@/lib/tables";
import { getUsers, type SystemUser } from "@/lib/users";
import { linkWaiterDevice, openTableOrders, printTablePrecuenta, readWaiterDevice, reportBlockedAttempt, saveWaiterDevice, sendToKitchen, setOverride, waiterBlock, waiterUsers } from "@/lib/waiter";

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
  const [table, setTable] = useState<Table | null>(null);
  const [diners, setDiners] = useState(2);
  const [category, setCategory] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [choosing, setChoosing] = useState<Product | null>(null);
  const [sending, setSending] = useState(false);
  const [tick, setTick] = useState(0);

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
    const timer = setInterval(load, 30_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, load));
      clearInterval(timer);
    };
  }, []);

  const me = useMemo(() => getUsers().find((u) => u.id === user.id) || { id: user.id, name: user.name, waiterAccess: undefined }, [user, tick]); // eslint-disable-line react-hooks/exhaustive-deps -- tick: recarga al cambiar usuarios o checador
  const block = useMemo(() => waiterBlock(me), [me, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const zones = useMemo(() => tableZones(tables), [tables]);
  const menu = useMemo(() => getDigitalMenu(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const available = useMemo(() => products.filter((p) => isAvailableOnline(menu, p) && isOnSale(p.saleSchedule)), [products, menu]);
  const categories = useMemo(() => sortCategories(Array.from(new Set(available.map((p) => p.category))), menu.categoryOrder), [available, menu]);
  const open = table ? openTableOrder(orders, table.id) : undefined;
  const cartTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);

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
    try {
      const failed = await printTablePrecuenta(open, user);
      if (failed.length) notify(`No salió la precuenta: ${failed.join(" · ")}`, "error");
      else notify("Precuenta impresa en caja.");
    } catch {
      notify("No se pudo imprimir la precuenta. Avisa en caja.", "error");
    }
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

  // --- lista de mesas
  if (!table) {
    const shown = tables.filter((t) => !zone || t.zone === zone);
    return (
      <div>
        {header}
        {banner}
        {zones.length > 1 && (
          <div className="mt-4 flex gap-2 overflow-x-auto">
            {["", ...zones].map((z) => (
              <button key={z || "todas"} onClick={() => setZone(z)} className={`shrink-0 rounded-xl px-3 py-2 text-sm font-black ${zone === z ? "bg-orange-500 text-black" : "border border-zinc-800 text-zinc-300"}`}>
                {z || "Todas"}
              </button>
            ))}
          </div>
        )}
        {tables.length === 0 && <p className="mt-8 text-center text-sm text-zinc-400">No hay mesas. En la caja: Configuración → Mesas.</p>}
        <div className="mt-4 grid grid-cols-3 gap-3">
          {shown.map((t) => {
            const o = openTableOrder(orders, t.id);
            return (
              <button key={t.id} onClick={() => { setTable(t); setCategory(""); setCart([]); }} className={`rounded-2xl border p-3 text-left ${o ? "border-orange-500/60 bg-orange-500/10" : "border-zinc-800 bg-zinc-950"}`}>
                <p className="text-xl font-black">{t.name}</p>
                <p className="text-[11px] text-zinc-500">{t.zone}</p>
                <p className={`mt-2 text-sm font-black ${o ? "text-orange-300" : "text-green-400"}`}>{o ? money(o.total) : "Libre"}</p>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // --- una mesa
  const list = available.filter((p) => !category || p.category === category);
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <button onClick={() => { setTable(null); setCart([]); }} className="rounded-xl border border-zinc-800 px-3 py-2 text-sm font-black">← Mesas</button>
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
          <ul className="mt-2 space-y-1 text-sm text-zinc-300">
            {open.items.map((i, idx) => (
              <li key={idx} className="flex justify-between gap-2">
                <span>{i.quantity} × {i.name}{i.comment ? <span className="text-zinc-500"> · {i.comment}</span> : null}</span>
                <span className="text-zinc-500">r{i.round || 1}</span>
              </li>
            ))}
          </ul>
          <button onClick={() => void precuenta()} className="mt-3 w-full rounded-xl border border-zinc-700 py-2 text-sm font-black">🧾 Precuenta</button>
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

      <div className="mt-4 flex gap-2 overflow-x-auto">
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
            <ul className="max-h-40 space-y-1 overflow-auto text-sm">
              {cart.map((i) => {
                const id = lineId(i);
                return (
                  <li key={id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate">{i.name}{i.comment ? <span className="text-zinc-500"> · {i.comment}</span> : null}</span>
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
