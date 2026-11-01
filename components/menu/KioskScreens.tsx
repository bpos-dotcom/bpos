"use client";
/**
 * Configuración → Menú digital → "Pantalla en el local (kiosco)".
 *
 * El kiosco es el mismo menú digital en una pantalla táctil del local: el
 * cliente arma su pedido y paga en una terminal Point que se enciende sola.
 * Aquí se genera el código para vincular cada pantalla (en la pantalla se
 * abre bpos.com.mx/kiosco y se escriben el correo de la cuenta y el código)
 * y se le asigna su terminal.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { aiFetch } from "@/lib/ai/client";
import { agentScope } from "@/lib/agent/client";
import { terminalLabel, type MpTerminal } from "@/lib/mp/client";
import { PUSH_SERVER as PUBLIC_SITE } from "@/lib/push/rules";

type Kiosk = { id: string; name: string; terminal_id: string; printer: string; paper_mm: number; last_seen_at: string | null; created_at: string };
type Agent = { id: string; name: string; kiosk_id: string | null; printers: { name: string; displayName?: string }[]; online: boolean };
type Screens = { kiosks: Kiosk[]; agents: Agent[]; terminals: MpTerminal[]; mpLinked: boolean; posTerminal: string | null };

const card = "rounded-3xl border border-zinc-800 bg-zinc-950 p-6";
const input = "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white";

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await aiFetch(path, init);
  const b = await r.json().catch(() => null);
  if (!r.ok || !b?.success) throw new Error(b?.error || "No se pudo.");
  return b as T;
}

const seen = (iso: string | null) => {
  if (!iso) return "nunca";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 2) return "en línea";
  if (min < 60) return `hace ${min} min`;
  return new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
};

export function KioskScreens({ published }: { published: boolean }) {
  const [data, setData] = useState<Screens | null | undefined>(undefined);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const { branchId } = await agentScope();
      setData(await call<Screens>(`/api/kiosco/pantallas?branch=${branchId}`, { cache: "no-store" }));
    } catch (e) {
      setData(null);
      setMessage(e instanceof Error ? e.message : "No se pudieron leer las pantallas.");
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pantallas de la sucursal: se piden al abrir el bloque
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [open, load]);

  async function run(action: () => Promise<unknown>, ok = "") {
    setBusy(true);
    setMessage("");
    try {
      await action();
      await load();
      if (ok) setMessage(ok);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo.");
    } finally {
      setBusy(false);
    }
  }

  async function newCode() {
    const { branchId } = await agentScope();
    setCode(await call<{ code: string; expiresAt: string }>("/api/kiosco/pantallas", { method: "POST", body: JSON.stringify({ branchId }) }));
  }

  const kiosks = data?.kiosks || [];
  const url = `${PUBLIC_SITE.replace(/^https?:\/\//, "")}/kiosco`;

  return (
    <section className={card}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black">🖥️ Pantalla en el local (kiosco)</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Tu mismo menú digital en una pantalla táctil del local: el cliente arma su pedido, toca Pagar y tu terminal Point se enciende con el total. El pedido
            llega a Pedidos en línea ya pagado, como “Kiosco · Para comer aquí” o “Kiosco · Para llevar”.
          </p>
        </div>
        <button onClick={() => setOpen((v) => !v)} className="rounded-2xl border border-zinc-700 px-4 py-2 text-sm font-black">
          {open ? "Ocultar" : kiosks.length ? `Ver pantallas (${kiosks.length})` : "Configurar"}
        </button>
      </div>

      {open && (
        <div className="mt-4 space-y-4">
          {!published && (
            <p className="rounded-2xl border border-orange-500/40 bg-orange-500/10 p-3 text-sm text-orange-200">
              Primero publica tu menú digital con pedidos activados: el kiosco usa el mismo menú.
            </p>
          )}
          {data && !data.mpLinked && (
            <p className="rounded-2xl border border-sky-500/40 bg-sky-500/10 p-3 text-sm text-sky-200">
              El kiosco cobra con tu terminal Point. Primero{" "}
              <Link href="/configuracion/metodos-de-pago" className="font-black underline">
                vincula tu cuenta de Mercado Pago
              </Link>
              .
            </p>
          )}

          <div className="rounded-2xl border border-zinc-800 bg-black p-4">
            <p className="font-black">Vincular una pantalla</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zinc-400">
              <li>
                En la pantalla táctil abre <b className="text-white">{url}</b> (Chrome o Edge en modo kiosco).
              </li>
              <li>Escribe el correo de tu cuenta de B-POS y el código de abajo.</li>
              <li>Aquí mismo elige qué terminal Point le toca a esa pantalla.</li>
              <li>
                ¿Ticket para el cliente? Instala B-POS Agent en la computadora del kiosco y vincúlalo en{" "}
                <Link href="/configuracion/sistema" className="font-black text-white underline">
                  Configuración → Sistema
                </Link>
                , igual que el de la caja. Luego aquí elige ese Agent y su impresora. Puede ser la misma computadora de la caja: entonces imprime las comandas y además el ticket del kiosco. Si es otra computadora, solo imprime el ticket del kiosco mientras la de la caja esté conectada.
              </li>
            </ol>
            {code ? (
              <div className="mt-3 rounded-2xl border border-emerald-500/50 bg-emerald-500/10 p-4 text-center">
                <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">Código de vinculación</p>
                <p className="mt-1 font-mono text-4xl font-black tracking-[0.3em] text-white">{code.code}</p>
                <p className="mt-1 text-xs text-emerald-200/80">
                  Vale 15 minutos y una sola vez (hasta las {new Date(code.expiresAt).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" })}).
                </p>
                <button disabled={busy} onClick={() => void run(newCode)} className="mt-2 text-xs font-bold text-emerald-200 underline disabled:opacity-50">
                  Generar otro código
                </button>
              </div>
            ) : (
              <button disabled={busy} onClick={() => void run(newCode)} className="mt-3 rounded-2xl bg-orange-500 px-4 py-2 font-black text-black disabled:opacity-50">
                Generar código
              </button>
            )}
          </div>

          {data === undefined && <p className="text-sm text-zinc-500">Cargando pantallas...</p>}
          {data && kiosks.length === 0 && <p className="text-sm text-zinc-500">Todavía no hay pantallas vinculadas en esta sucursal.</p>}
          {kiosks.map((k) => {
            const agents = data?.agents || [];
            const mine = agents.find((a) => a.kiosk_id === k.id) || null;
            const patch = (body: Record<string, unknown>, ok = "") => run(() => call("/api/kiosco/pantallas", { method: "PATCH", body: JSON.stringify({ id: k.id, ...body }) }), ok);
            return (
            <div key={k.id} className="grid gap-3 rounded-2xl border border-zinc-800 bg-black p-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <label className="block text-sm font-bold text-zinc-300">
                Nombre
                <input
                  defaultValue={k.name}
                  maxLength={60}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== k.name) void patch({ name });
                  }}
                  className={`${input} mt-1`}
                />
                <span className="mt-1 block text-xs font-normal text-zinc-500">Última señal: {seen(k.last_seen_at)}</span>
              </label>
              <label className="block text-sm font-bold text-zinc-300">
                Terminal Point de esta pantalla
                <select
                  value={k.terminal_id}
                  disabled={busy || !data?.mpLinked}
                  onChange={(e) => void patch({ terminalId: e.target.value }, e.target.value ? "✅ Listo. Si es la primera vez que la terminal se conecta a B-POS, apágala y vuélvela a prender." : "")}
                  className={`${input} mt-1`}
                >
                  <option value="">Sin terminal (no puede cobrar)</option>
                  {(data?.terminals || []).map((t) => (
                    <option key={t.id} value={t.id}>
                      📟 {terminalLabel(t.id)}
                      {t.id === data?.posTerminal ? " · la usa la caja" : ""}
                    </option>
                  ))}
                </select>
                {k.terminal_id && k.terminal_id === data?.posTerminal && (
                  <span className="mt-1 block text-xs font-normal text-yellow-300">⚠️ Es la misma terminal que cobra la caja. Mientras el kiosco la use, conviene que el kiosco tenga la suya.</span>
                )}
                {data?.mpLinked && data.terminals.length === 0 && (
                  <span className="mt-1 block text-xs font-normal text-zinc-500">No hay terminales en tu cuenta de Mercado Pago. Enciende la terminal e inicia sesión en ella con tu cuenta.</span>
                )}
              </label>
              <div className="grid gap-3 md:col-span-2 md:grid-cols-[1fr_1fr_auto] md:items-end">
                <label className="block text-sm font-bold text-zinc-300">
                  🧾 Computadora del kiosco (B-POS Agent)
                  <select value={mine?.id || ""} disabled={busy} onChange={(e) => void patch({ agentId: e.target.value }, e.target.value ? "Ahora elige la impresora del ticket." : "")} className={`${input} mt-1`}>
                    <option value="">Sin ticket impreso (solo el número en pantalla)</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id} disabled={Boolean(a.kiosk_id && a.kiosk_id !== k.id)}>
                        {a.online ? "🟢" : "🔴"} {a.name || "B-POS Agent"}
                        {a.kiosk_id && a.kiosk_id !== k.id ? " · es de otra pantalla" : !a.kiosk_id ? " · la de la caja" : ""}
                      </option>
                    ))}
                  </select>
                  {agents.length === 0 && <span className="mt-1 block text-xs font-normal text-zinc-500">Esta sucursal no tiene ningún B-POS Agent vinculado.</span>}
                </label>
                <label className="block text-sm font-bold text-zinc-300">
                  Impresora del ticket
                  <select value={k.printer} disabled={busy || !mine} onChange={(e) => void patch({ printer: e.target.value }, e.target.value ? "✅ Listo: el ticket del cliente saldrá ahí al aprobarse el pago." : "")} className={`${input} mt-1`}>
                    <option value="">Elige la impresora</option>
                    {(mine?.printers || []).map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.displayName || p.name}
                      </option>
                    ))}
                    {k.printer && !(mine?.printers || []).some((p) => p.name === k.printer) && <option value={k.printer}>{k.printer} (no la reporta el Agent)</option>}
                  </select>
                  {mine && mine.printers.length === 0 && <span className="mt-1 block text-xs font-normal text-zinc-500">Ese Agent no reporta impresoras: revisa que esté prendido y con la impresora instalada en Windows.</span>}
                </label>
                <label className="block text-sm font-bold text-zinc-300">
                  Papel
                  <select value={k.paper_mm === 58 ? 58 : 80} disabled={busy || !mine} onChange={(e) => void patch({ paperMm: Number(e.target.value) })} className={`${input} mt-1`}>
                    <option value={80}>80 mm</option>
                    <option value={58}>58 mm</option>
                  </select>
                </label>
              </div>
              <button
                disabled={busy}
                onClick={() => {
                  if (confirm(`¿Desvincular la pantalla "${k.name}"? Dejará de poder pedir y cobrar.`)) {
                    void run(() => call(`/api/kiosco/pantallas?id=${encodeURIComponent(k.id)}`, { method: "DELETE" }), "Pantalla desvinculada.");
                  }
                }}
                className="rounded-2xl border border-red-500/60 px-4 py-3 text-sm font-black text-red-300 disabled:opacity-50"
              >
                Desvincular
              </button>
            </div>
            );
          })}

          <p className="text-xs text-zinc-500">
            La terminal del kiosco queda en modo conectado (PDV): solo acepta cobros que le mande B-POS. Funciona con Point Smart y Point Pro 2. Para que la
            pantalla abra sola al encender, usa Chrome o Edge con <code className="rounded bg-zinc-800 px-1">--kiosk {PUBLIC_SITE}/kiosco</code>.
          </p>
          {message && <p className="text-sm font-bold text-yellow-200">{message}</p>}
        </div>
      )}
    </section>
  );
}
