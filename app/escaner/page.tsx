"use client";
/**
 * Celular como escáner: bpos.com.mx/escaner#<llave>
 *
 * Se abre al leer el QR que muestra la caja sin cámara. Usa la cámara del
 * celular y manda cada código a esa caja por tiempo real (lib/phone-scanner.ts).
 * No pide cuenta: la llave del QR es la que liga este celular con esa caja.
 */
import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { CameraScanner } from "@/components/retail/CameraScanner";
import { scanChannel, scanId, tokenFromHash } from "@/lib/phone-scanner";
import { getSupabase, isCloudConfigured } from "@/lib/supabase/client";

type Result = { ok: boolean; text: string };

export default function PhoneScannerPage() {
  const [token, setToken] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [waiting, setWaiting] = useState(false); // la caja tiene abierto el escáner
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [round, setRound] = useState(0); // cada lectura vuelve a abrir la cámara
  const [sending, setSending] = useState(false);
  const [typed, setTyped] = useState("");
  const channelRef = useRef<RealtimeChannel | null>(null);
  // La cámara se vuelve a abrir un momento después (para no leer otra vez el mismo código)
  const nextRound = () => window.setTimeout(() => setRound((r) => r + 1), 1200);
  const pending = useRef<{ id: string; timer: number } | null>(null);

  useEffect(() => {
    document.documentElement.classList.remove("theme-light");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- la llave viene en la dirección
    setToken(tokenFromHash(window.location.hash));
  }, []);

  useEffect(() => {
    if (!token || !isCloudConfigured) return;
    const supabase = getSupabase();
    const channel = supabase.channel(scanChannel(token), { config: { broadcast: { self: false } } });
    channelRef.current = channel;
    channel
      .on("broadcast", { event: "listo" }, ({ payload }) => {
        setWaiting(true);
        setPrompt(String((payload as { prompt?: string })?.prompt || ""));
      })
      .on("broadcast", { event: "cerrado" }, () => setWaiting(false))
      .on("broadcast", { event: "recibido" }, ({ payload }) => {
        const p = (payload || {}) as { id?: string; ok?: boolean; text?: string };
        if (!pending.current || p.id !== pending.current.id) return;
        window.clearTimeout(pending.current.timer);
        pending.current = null;
        setSending(false);
        setResult({ ok: Boolean(p.ok), text: String(p.text || "") });
        try {
          navigator.vibrate?.(p.ok ? 60 : [60, 60, 60]);
        } catch {}
        if (p.ok) setWaiting(false); // la caja cierra el escáner al recibirlo
        nextRound();
      })
      .subscribe((s) => {
        if (s === "SUBSCRIBED") {
          setConnected(true);
          void channel.send({ type: "broadcast", event: "hola", payload: {} });
        } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") setConnected(false);
      });
    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [token]);

  const sendCode = (code: string) => {
    const channel = channelRef.current;
    if (!channel) return;
    const id = scanId();
    setSending(true);
    setResult(null);
    const payload = { code, id };
    void channel.send({ type: "broadcast", event: "codigo", payload });
    // Si la caja no contesta, se reintenta una vez (la caja ignora el repetido)
    const retry = window.setTimeout(() => {
      void channel.send({ type: "broadcast", event: "codigo", payload });
      if (pending.current) pending.current.timer = window.setTimeout(giveUp, 3500);
    }, 2500);
    const giveUp = () => {
      pending.current = null;
      setSending(false);
      setResult({ ok: false, text: "La caja no contestó. En la caja toca 📷 para abrir el escáner y vuelve a escanear." });
      nextRound();
    };
    pending.current = { id, timer: retry };
  };

  if (token === null) return <main className="min-h-screen bg-black" />;

  return (
    <main className="min-h-screen bg-black px-4 py-6 text-white" data-phone-scanner-page>
      <div className="mx-auto max-w-md">
        <h1 className="text-xl font-black">📱 Celular como escáner</h1>
        {!token ? (
          <p className="mt-4 rounded-2xl border border-red-900 bg-red-950/40 p-4 text-sm font-bold text-red-200">
            Esta liga no sirve. En la caja toca 📷 y vuelve a leer el QR con la cámara del celular.
          </p>
        ) : !isCloudConfigured ? (
          <p className="mt-4 text-sm font-bold text-red-300">Esta versión de B-POS no tiene nube.</p>
        ) : (
          <>
            <p className="mt-2 text-sm" data-phone-state={!connected ? "conectando" : waiting ? "esperando" : "ligado"}>
              {!connected ? (
                <span className="text-zinc-400">Conectando con la caja…</span>
              ) : waiting ? (
                <span className="font-bold text-emerald-300">✓ La caja está esperando{prompt ? `: ${prompt.replace(/^\S+\s/, "")}` : ""}. Escanea.</span>
              ) : (
                <span className="text-zinc-300">Ligado a la caja. Cuando en la caja toques 📷, escanea aquí.</span>
              )}
            </p>
            <div className="mt-4 rounded-3xl border border-zinc-800 bg-zinc-950 p-3">
              <CameraScanner key={round} embedded checkDigit={false} onClose={() => {}} onCode={sendCode} />
            </div>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const code = typed.trim();
                if (code.length < 4 || sending) return;
                setTyped("");
                sendCode(code);
              }}
            >
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="¿No lo lee? Escribe el código" inputMode="text" autoComplete="off" className="min-w-0 flex-1 rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-orange-500" data-phone-typed />
              <button type="submit" disabled={sending || typed.trim().length < 4} className="rounded-2xl bg-orange-500 px-4 py-2 text-sm font-black text-black disabled:opacity-40" data-phone-send>
                Enviar
              </button>
            </form>
            {sending && <p className="mt-3 text-sm font-bold text-zinc-300">Enviando a la caja…</p>}
            {result && (
              <p className={`mt-3 rounded-2xl p-3 text-sm font-bold ${result.ok ? "bg-emerald-950/50 text-emerald-200" : "bg-amber-950/50 text-amber-200"}`} data-phone-result={result.ok ? "ok" : "error"}>
                {result.text}
              </p>
            )}
            <p className="mt-4 text-xs text-zinc-500">Deja esta página abierta mientras trabajas. La imagen no sale del celular: solo se manda el código.</p>
          </>
        )}
      </div>
    </main>
  );
}
