"use client";
/**
 * Configuración → Métodos de pago → Mercado Pago: el dueño vincula SU cuenta
 * (el dinero llega directo a ella) y elige la terminal Point de la sucursal.
 * Con terminal, al cobrar con tarjeta en el POS la terminal se enciende sola
 * con el monto.
 */
import { useCallback, useEffect, useState } from "react";
import {
  forgetTerminalCache,
  getMpStatus,
  listMpTerminals,
  removeMpTerminal,
  selectMpTerminal,
  startMpLink,
  terminalLabel,
  unlinkMp,
  type MpStatus,
  type MpTerminal,
} from "@/lib/mp/client";

export function MercadoPagoCard() {
  const [status, setStatus] = useState<MpStatus | null>(null);
  const [terminals, setTerminals] = useState<MpTerminal[] | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [setupMissing, setSetupMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await getMpStatus();
      setStatus(s);
      if (s.linked) {
        const t = await listMpTerminals().catch((e) => {
          setMessage(e instanceof Error ? e.message : "No se pudieron leer tus terminales.");
          return null;
        });
        setTerminals(t?.terminals || []);
      }
    } catch (e) {
      if ((e as { code?: string }).code === "setup") setSetupMissing(true);
      else setMessage(e instanceof Error ? e.message : "No se pudo revisar Mercado Pago.");
    }
  }, []);

  useEffect(() => {
    // Regreso de Mercado Pago (?mp=ok | ?mp=error&msg=...)
    const q = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- aviso del regreso: solo después de montar
    if (q.get("mp") === "ok") setMessage("✅ Tu cuenta de Mercado Pago quedó vinculada.");
    if (q.get("mp") === "error") setMessage(`No se pudo vincular: ${q.get("msg") || "inténtalo de nuevo"}`);
    if (q.get("mp")) window.history.replaceState(null, "", "/configuracion/pagos");
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, done = "") {
    setBusy(true);
    setMessage("");
    try {
      await action();
      forgetTerminalCache();
      if (done) setMessage(done);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-sky-500/40 bg-gradient-to-br from-sky-500/10 to-zinc-950 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-xl font-black text-sky-300">💳 Mercado Pago</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Vincula tu cuenta de Mercado Pago: cuando cobres con tarjeta en el POS, tu terminal Point se enciende sola con el monto. El dinero llega
            directo a tu cuenta; B-POS no cobra comisión.
          </p>
        </div>
        {status?.linked && (
          <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-sm font-black text-emerald-300">✅ Vinculada{status.nickname ? ` · ${status.nickname}` : ""}</span>
        )}
      </div>

      {setupMissing && (
        <p className="mt-4 rounded-2xl border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-100">
          La conexión con Mercado Pago se está activando en B-POS. Vuelve a intentarlo en un rato.
        </p>
      )}

      {status && !status.linked && (
        <div className="mt-5">
          {status.canLink ? (
            <button disabled={busy} onClick={() => void run(startMpLink)} className="rounded-2xl bg-sky-500 px-6 py-3 font-black text-black disabled:opacity-50">
              {busy ? "Abriendo Mercado Pago..." : "Vincular mi cuenta de Mercado Pago"}
            </button>
          ) : (
            <p className="text-sm text-zinc-400">Pide a la cuenta dueña del negocio que vincule Mercado Pago.</p>
          )}
          <p className="mt-2 text-xs text-zinc-500">Te lleva a Mercado Pago para iniciar sesión y autorizar a B-POS. Tu contraseña nunca pasa por B-POS.</p>
        </div>
      )}

      {status?.linked && (
        <div className="mt-5 space-y-4">
          <div>
            <p className="text-sm font-black text-zinc-300">Terminal Point de esta sucursal</p>
            {terminals === null && <p className="mt-2 text-sm text-zinc-500">Buscando tus terminales...</p>}
            {terminals?.length === 0 && (
              <p className="mt-2 text-sm text-zinc-400">
                No hay terminales Point en tu cuenta. Enciende tu terminal, inicia sesión en ella con tu cuenta de Mercado Pago y vuelve a abrir esta página.
              </p>
            )}
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {terminals?.map((t) => {
                const selected = status.terminal === t.id;
                return (
                  <button
                    key={t.id}
                    disabled={busy || !status.canLink}
                    onClick={() => void run(() => selectMpTerminal(t.id), "✅ Listo: al cobrar con tarjeta, esta terminal recibe el monto.")}
                    className={`rounded-2xl border p-4 text-left ${selected ? "border-emerald-400 bg-emerald-500/10" : "border-zinc-700 bg-black hover:border-sky-400"}`}
                  >
                    <p className="font-black">📟 {terminalLabel(t.id)}</p>
                    <p className="text-xs text-zinc-500">
                      {selected ? "En uso en esta sucursal" : "Toca para usarla aquí"} · modo {t.operating_mode === "PDV" ? "conectado al POS" : "normal (se cambia solo)"}
                    </p>
                  </button>
                );
              })}
            </div>
            {status.terminal && status.canLink && (
              <button disabled={busy} onClick={() => void run(removeMpTerminal, "Esta sucursal ya no manda cobros a la terminal.")} className="mt-3 text-sm text-zinc-400 underline">
                Dejar de usar la terminal en esta sucursal
              </button>
            )}
          </div>
          {status.canLink && (
            <button
              disabled={busy}
              onClick={() => {
                if (confirm("¿Desvincular tu cuenta de Mercado Pago? El POS dejará de mandar cobros a la terminal.")) void run(unlinkMp, "Cuenta desvinculada.");
              }}
              className="rounded-2xl border border-zinc-700 px-4 py-2 text-sm font-black text-zinc-300 hover:border-red-500"
            >
              Desvincular cuenta
            </button>
          )}
        </div>
      )}

      {message && <p className="mt-4 text-sm font-bold text-zinc-200">{message}</p>}
    </section>
  );
}
