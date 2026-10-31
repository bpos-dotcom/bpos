"use client";
/**
 * Cuenta del cliente en el menú digital: registro (nombre, teléfono, correo
 * y contraseña, con código por correo), entrar con teléfono y contraseña,
 * "Mis pedidos" y "Pedir otra vez". La sesión se guarda en este celular.
 * Lo resuelve el servidor de B-POS (app/api/cuenta).
 */
import { useCallback, useEffect, useState } from "react";
import type { OnlineOrderData } from "@/lib/digital-menu";

export type CustomerAccount = { id: string; name: string; phone: string; email: string; address: { address?: string; reference?: string; location?: { lat: number; lng: number } } };
export type CustomerOrder = { id: string; token: string; folio: string; status: string; data: OnlineOrderData; created_at: string };

// Sin el prefijo "bpos_" para que la sincronización del negocio nunca la suba
const sessionKey = (slug: string) => `cliente-sesion:${slug}`;

export async function callAccount<T = Record<string, unknown>>(action: string, slug: string, body: Record<string, unknown> = {}, token = ""): Promise<T> {
  const res = await fetch(`/api/cuenta/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ slug, ...body }),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(data.error || "Algo falló. Intenta otra vez."), { status: res.status });
  return data;
}

/** Sesión del cliente en este restaurante */
export function useCustomer(slug: string) {
  const [token, setToken] = useState("");
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);

  const refresh = useCallback(
    async (t = token) => {
      if (!t) return;
      try {
        const r = await callAccount<{ account: CustomerAccount; orders: CustomerOrder[] }>("yo", slug, {}, t);
        setAccount(r.account);
        setOrders(r.orders);
      } catch (e) {
        if ((e as { status?: number }).status === 401) {
          try {
            localStorage.removeItem(sessionKey(slug));
          } catch {}
          setToken("");
          setAccount(null);
          setOrders([]);
        }
      }
    },
    [slug, token]
  );

  useEffect(() => {
    let saved = "";
    try {
      saved = localStorage.getItem(sessionKey(slug)) || "";
    } catch {}
    if (!saved) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sesión guardada en el celular
    setToken(saved);
    void refresh(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir
  }, [slug]);

  const signIn = useCallback(
    (t: string, a: CustomerAccount) => {
      try {
        localStorage.setItem(sessionKey(slug), t);
      } catch {}
      setToken(t);
      setAccount(a);
      void refresh(t);
    },
    [slug, refresh]
  );

  const signOut = useCallback(async () => {
    if (token) await callAccount("salir", slug, {}, token).catch(() => undefined);
    try {
      localStorage.removeItem(sessionKey(slug));
    } catch {}
    setToken("");
    setAccount(null);
    setOrders([]);
  }, [slug, token]);

  /** Guarda un pedido recién hecho en "Mis pedidos" */
  const linkOrder = useCallback(
    async (orderId: string, orderToken: string, t = token) => {
      if (!t) return;
      await callAccount("vincular", slug, { orderId, orderToken }, t).catch(() => undefined);
      void refresh(t);
    },
    [slug, token, refresh]
  );

  return { token, account, orders, refresh, signIn, signOut, linkOrder };
}

export type Customer = ReturnType<typeof useCustomer>;

const STATUS: Record<string, { text: string; cls: string }> = {
  nuevo: { text: "Por confirmar", cls: "bg-amber-100 text-amber-800" },
  aceptando: { text: "Por confirmar", cls: "bg-amber-100 text-amber-800" },
  aceptado: { text: "Preparando", cls: "bg-sky-100 text-sky-800" },
  listo: { text: "Listo", cls: "bg-emerald-100 text-emerald-800" },
  entregado: { text: "Entregado", cls: "bg-zinc-100 text-zinc-700" },
  rechazado: { text: "Rechazado", cls: "bg-red-100 text-red-700" },
};

const field = "mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-base";
const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;

type View = "entrar" | "registro" | "codigo" | "olvide" | "restablecer" | "cuenta";

export function AccountSheet({
  slug,
  color,
  businessName,
  customer,
  start = "entrar",
  prefill,
  onClose,
  onSignedIn,
  onReorder,
  onOpenOrder,
}: {
  slug: string;
  color: string;
  businessName: string;
  customer: Customer;
  start?: View;
  prefill?: { name?: string; phone?: string };
  onClose: () => void;
  /** Recién entró (con su llave): para guardar el pedido que acaba de hacer */
  onSignedIn?: (token: string) => void;
  onReorder?: (order: CustomerOrder) => void;
  onOpenOrder?: (order: CustomerOrder) => void;
}) {
  const [view, setView] = useState<View>(customer.account ? "cuenta" : start);
  const [name, setName] = useState(prefill?.name || "");
  const [phone, setPhone] = useState(prefill?.phone || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  /** Recién creó su cuenta: se le invita al club del restaurante */
  const [justJoined, setJustJoined] = useState(false);
  const [club, setClub] = useState<{ enabled: boolean; name: string; welcome: string } | null>(null);
  useEffect(() => {
    callAccount<{ club: { enabled: boolean; name: string; welcome: string } }>("club", slug)
      .then((r) => setClub(r.club))
      .catch(() => undefined);
  }, [slug]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Algo falló.");
    } finally {
      setBusy(false);
    }
  }

  const done = (r: { token: string; account: CustomerAccount }) => {
    customer.signIn(r.token, r.account);
    onSignedIn?.(r.token);
    setPassword("");
    setCode("");
    setView("cuenta");
  };

  const register = () =>
    run(async () => {
      const r = await callAccount<{ email: string }>("registro", slug, { name, phone, email, password });
      setSentTo(r.email);
      setView("codigo");
    });
  const verify = () =>
    run(async () => {
      done(await callAccount("verificar", slug, { phone, code }));
      setJustJoined(true);
    });
  const resend = () =>
    run(async () => {
      await callAccount("reenviar", slug, { phone });
      setNote("Te mandamos otro código.");
    });
  const login = () =>
    run(async () => {
      const r = await callAccount<{ token?: string; account?: CustomerAccount; needsCode?: boolean; email?: string }>("entrar", slug, { phone, password });
      if (r.needsCode) {
        setSentTo(r.email || "");
        setView("codigo");
        setNote("Falta confirmar tu correo: te mandamos un código.");
        return;
      }
      done(r as { token: string; account: CustomerAccount });
    });
  const forgot = () =>
    run(async () => {
      const r = await callAccount<{ email: string }>("olvide", slug, { phone });
      setSentTo(r.email);
      setView("restablecer");
    });
  const reset = () => run(async () => done(await callAccount("restablecer", slug, { phone, code, password })));

  const passInput = (placeholder: string) => (
    <div className="relative">
      <input
        type={showPass ? "text" : "password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={placeholder}
        autoComplete={view === "entrar" ? "current-password" : "new-password"}
        className={`${field} pr-16`}
      />
      <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-xs font-bold text-zinc-500">
        {showPass ? "Ocultar" : "Ver"}
      </button>
    </div>
  );
  const phoneInput = (
    <label className="mt-3 block text-sm font-bold">
      Teléfono (WhatsApp)
      <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="tel" autoComplete="tel" placeholder="10 dígitos" className={field} />
    </label>
  );
  const mainButton = (text: string, onClick: () => void, disabled = false) => (
    <button disabled={busy || disabled} onClick={onClick} className="mt-4 w-full rounded-2xl py-3.5 text-base font-black text-white disabled:opacity-40" style={{ background: color }}>
      {busy ? "Un momento..." : text}
    </button>
  );
  const link = (text: string, onClick: () => void) => (
    <button onClick={onClick} className="text-sm font-bold underline" style={{ color }}>
      {text}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 text-zinc-900 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-black">
            {view === "cuenta" ? `Hola, ${customer.account?.name.split(" ")[0] || ""} 👋` : view === "registro" ? "Crea tu cuenta" : view === "codigo" ? "Revisa tu correo" : view === "entrar" ? "Mi cuenta" : "Cambiar contraseña"}
          </h2>
          <button onClick={onClose} className="rounded-full bg-zinc-100 px-3 py-1 font-black">✕</button>
        </div>

        {view === "entrar" && (
          <>
            <p className="mt-1 text-sm text-zinc-500">Entra para ver tus pedidos en {businessName}.</p>
            {phoneInput}
            <label className="mt-3 block text-sm font-bold">Contraseña{passInput("Tu contraseña")}</label>
            {mainButton("Entrar", login, phone.length !== 10 || !password)}
            <div className="mt-3 flex flex-wrap justify-between gap-2">
              {link("Crear cuenta", () => setView("registro"))}
              {link("Olvidé mi contraseña", () => setView("olvide"))}
            </div>
          </>
        )}

        {view === "registro" && (
          <>
            <ul className="mt-2 space-y-1 rounded-2xl bg-orange-50 p-3 text-sm">
              <li>🧾 Ve el historial de tus pedidos</li>
              <li>🔁 Pide otra vez con un toque</li>
              <li>⚡ Tus datos se llenan solos</li>
            </ul>
            <label className="mt-3 block text-sm font-bold">
              Tu nombre
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={field} />
            </label>
            {phoneInput}
            <label className="mt-3 block text-sm font-bold">
              Correo (te mandamos un código)
              <input value={email} onChange={(e) => setEmail(e.target.value.trim())} type="email" inputMode="email" autoComplete="email" className={field} />
            </label>
            <label className="mt-3 block text-sm font-bold">Contraseña{passInput("Mínimo 6 caracteres")}</label>
            {mainButton("Crear mi cuenta", register, name.trim().length < 2 || phone.length !== 10 || !email.includes("@") || password.length < 6)}
            <p className="mt-3 text-center text-sm text-zinc-500">¿Ya tienes cuenta? {link("Entra aquí", () => setView("entrar"))}</p>
          </>
        )}

        {(view === "codigo" || view === "restablecer") && (
          <>
            <p className="mt-1 text-sm text-zinc-600">
              Te mandamos un código de 6 dígitos{sentTo ? ` a ${sentTo}` : " a tu correo"}. ¿No llega? Revisa en <b>Spam</b> o <b>Promociones</b>.
            </p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              className={`${field} text-center font-mono text-3xl tracking-[0.4em]`}
            />
            {view === "restablecer" && <label className="mt-3 block text-sm font-bold">Nueva contraseña{passInput("Mínimo 6 caracteres")}</label>}
            {view === "codigo" ? mainButton("Confirmar", verify, code.length !== 6) : mainButton("Cambiar contraseña", reset, code.length !== 6 || password.length < 6)}
            <div className="mt-3 flex flex-wrap justify-between gap-2">
              {view === "codigo" ? link("Mandar otro código", resend) : link("Mandar otro código", forgot)}
              {link("Volver", () => setView("entrar"))}
            </div>
          </>
        )}

        {view === "olvide" && (
          <>
            <p className="mt-1 text-sm text-zinc-500">Escribe tu teléfono y te mandamos un código al correo de tu cuenta.</p>
            {phoneInput}
            {mainButton("Mandar código", forgot, phone.length !== 10)}
            <div className="mt-3">{link("Volver", () => setView("entrar"))}</div>
          </>
        )}

        {view === "cuenta" && customer.account && (
          <>
            <p className="text-sm text-zinc-500">
              {customer.account.phone} · {customer.account.email}
            </p>
            {club?.enabled &&
              (justJoined ? (
                <div className="mt-4 rounded-2xl border-2 p-4 text-center" style={{ borderColor: color }}>
                  <p className="text-2xl">⭐</p>
                  <p className="font-black">¿Quieres unirte al {club.name}?</p>
                  {club.welcome && <p className="mt-1 text-sm text-zinc-600">🎁 {club.welcome}</p>}
                  <a href={`/fidelidad/${slug}`} className="mt-3 block rounded-2xl py-3 font-black text-white" style={{ background: color }}>
                    Unirme
                  </a>
                  <button onClick={() => setJustJoined(false)} className="mt-2 text-xs font-bold text-zinc-400 underline">
                    Ahora no
                  </button>
                </div>
              ) : (
                <a href={`/fidelidad/${slug}`} className="mt-4 flex items-center justify-between rounded-2xl border border-zinc-200 p-3 font-black">
                  <span>⭐ Mi tarjeta del {club.name}</span>
                  <span style={{ color }}>Ver →</span>
                </a>
              ))}
            <h3 className="mt-4 font-black">🧾 Mis pedidos</h3>
            <div className="mt-2 space-y-2">
              {customer.orders.map((o) => {
                const s = STATUS[o.status] || STATUS.nuevo;
                return (
                  <div key={o.id} className="rounded-2xl border border-zinc-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-black tracking-widest">{o.folio}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-black ${s.cls}`}>{s.text}</span>
                    </div>
                    <p className="text-xs text-zinc-500">
                      {new Date(o.created_at).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {money(o.data.total)}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm">{o.data.lines.map((l) => `${l.quantity} ${l.name}`).join(", ")}</p>
                    <div className="mt-2 flex gap-2">
                      {onReorder && (
                        <button onClick={() => onReorder(o)} className="flex-1 rounded-xl py-2 text-sm font-black text-white" style={{ background: color }}>
                          🔁 Pedir otra vez
                        </button>
                      )}
                      {onOpenOrder && (
                        <button onClick={() => onOpenOrder(o)} className="rounded-xl border border-zinc-200 px-3 py-2 text-sm font-black">
                          Ver
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {customer.orders.length === 0 && <p className="rounded-2xl bg-zinc-50 p-4 text-center text-sm text-zinc-500">Aquí aparecerán los pedidos que hagas con tu cuenta.</p>}
            </div>
            <button onClick={() => void customer.signOut().then(() => setView("entrar"))} className="mt-5 w-full rounded-2xl border border-zinc-200 py-3 text-sm font-black text-zinc-500">
              Cerrar sesión
            </button>
          </>
        )}

        {note && <p className="mt-3 text-sm font-bold text-emerald-700">{note}</p>}
        {error && <p className="mt-3 text-sm font-bold text-red-600">{error}</p>}
      </div>
    </div>
  );
}
