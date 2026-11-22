"use client";
/**
 * Lado de la caja del "celular como escáner" (ver lib/phone-scanner.ts):
 * muestra el QR para ligar el celular y espera los códigos que manda. Al
 * recibir uno llama onCode y se cierra, igual que la cámara del equipo.
 */
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { cleanScannedCode } from "@/lib/barcode-camera";
import { acceptPhoneCode, deviceScanToken, scanChannel, scannerUrl } from "@/lib/phone-scanner";
import { PUSH_SERVER } from "@/lib/push/rules";
import { getSupabase, isCloudConfigured } from "@/lib/supabase/client";

/** Dirección pública que el celular puede abrir (la caja local o una prueba en localhost no sirven desde el celular) */
function publicOrigin() {
  const { origin, hostname, protocol } = window.location;
  const local = /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(hostname) || hostname.endsWith(".localhost");
  return protocol === "https:" && !local ? origin : PUSH_SERVER;
}

export function PhoneScanner({ onCode, onClose, prompt = "📱 Escanea con tu celular", checkDigit = true }: { onCode: (code: string) => void; onClose: () => void; prompt?: string; checkDigit?: boolean }) {
  const [token, setToken] = useState("");
  const [qr, setQr] = useState("");
  const [phone, setPhone] = useState(false);
  const [status, setStatus] = useState<"conectando" | "listo" | "error">("conectando");
  const [last, setLast] = useState("");
  const handler = useRef(onCode);
  const checkDigitRef = useRef(checkDigit);
  const promptRef = useRef(prompt);
  useEffect(() => {
    handler.current = onCode;
    checkDigitRef.current = checkDigit;
    promptRef.current = prompt;
  }, [onCode, checkDigit, prompt]);

  // Llave ligada a este equipo (la misma cada vez: el celular no vuelve a leer el QR)
  useEffect(() => {
    let store: Storage | null = null;
    try {
      store = window.localStorage;
    } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect -- solo se sabe en el navegador
    setToken(deviceScanToken(store));
  }, []);

  // La llave solo existe en el navegador (se crea en el efecto de arriba)
  const url = token ? scannerUrl(publicOrigin(), token) : "";
  useEffect(() => {
    if (!url) return;
    void QRCode.toDataURL(url, { margin: 1, width: 240 }).then(setQr).catch(() => setQr(""));
  }, [url]);

  useEffect(() => {
    if (!token || !isCloudConfigured) return;
    const seen = new Set<string>();
    let done = false;
    const supabase = getSupabase();
    const channel: RealtimeChannel = supabase.channel(scanChannel(token), { config: { broadcast: { self: false } } });
    const send = (event: string, payload: Record<string, unknown> = {}) => void channel.send({ type: "broadcast", event, payload });
    channel
      .on("broadcast", { event: "hola" }, () => {
        setPhone(true);
        send("listo", { prompt: promptRef.current });
      })
      .on("broadcast", { event: "codigo" }, ({ payload }) => {
        const r = acceptPhoneCode(seen, (payload || {}) as { code?: unknown; id?: unknown }, (raw) => cleanScannedCode(raw, { checkDigit: checkDigitRef.current }));
        setPhone(true);
        if (r.reason === "sin-id") return;
        if (r.reason === "repetido") return send("recibido", { id: r.id, ok: true, text: "Ya llegó a la caja" });
        if (!r.use) {
          setLast("Llegó un código que no se pudo leer bien. Vuelve a escanear.");
          return send("recibido", { id: r.id, ok: false, text: "No se leyó bien. Vuelve a escanear." });
        }
        if (done) return send("recibido", { id: r.id, ok: false, text: "La caja ya cerró el escáner" });
        done = true;
        send("recibido", { id: r.id, ok: true, text: `✓ Llegó a la caja: ${r.code}` });
        handler.current(r.code);
      })
      .subscribe((s) => {
        if (s === "SUBSCRIBED") {
          setStatus("listo");
          // Si el celular ya estaba abierto, se entera de que la caja espera
          send("listo", { prompt: promptRef.current });
        } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") setStatus("error");
      });
    return () => {
      send("cerrado");
      void supabase.removeChannel(channel);
    };
  }, [token]);

  const renew = () => {
    let store: Storage | null = null;
    try {
      store = window.localStorage;
    } catch {}
    setPhone(false);
    setToken(deviceScanToken(store, true));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose} data-phone-scanner>
      <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-950 p-5 text-center" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 text-left">
          <p className="font-black text-white">📱 Celular como escáner</p>
          <button type="button" onClick={onClose} className="rounded-full bg-zinc-800 px-3 py-1 text-lg text-white" aria-label="Cerrar">
            ✕
          </button>
        </div>
        {!isCloudConfigured ? (
          <p className="mt-4 text-sm font-bold text-red-300">El celular como escáner necesita la cuenta en la nube.</p>
        ) : (
          <>
            <p className="mt-2 text-left text-sm text-zinc-400">
              {phone ? "Celular conectado: escanea con él y aparece aquí." : "Este equipo no tiene cámara. Lee este QR con la cámara de tu celular; se queda ligado para la próxima vez."}
            </p>
            <div className="mx-auto mt-4 flex h-[240px] w-[240px] items-center justify-center rounded-2xl bg-white p-2">
              {qr ? <img src={qr} alt="QR para ligar el celular" width={224} height={224} data-phone-qr /> : <span className="text-sm text-zinc-500">Preparando…</span>}
            </div>
            <p className="mt-3 text-xs font-bold" data-phone-status={phone ? "conectado" : status}>
              {status === "error" ? (
                <span className="text-red-300">Sin conexión con la nube. Revisa el internet.</span>
              ) : phone ? (
                <span className="text-emerald-300">📱 Celular conectado · esperando código…</span>
              ) : status === "listo" ? (
                <span className="text-zinc-400">Esperando al celular…</span>
              ) : (
                <span className="text-zinc-500">Conectando…</span>
              )}
            </p>
            {last && <p className="mt-2 text-xs font-bold text-amber-300">{last}</p>}
            <div className="mt-4 flex items-center justify-center gap-3 text-xs">
              <button type="button" onClick={renew} className="rounded-full border border-zinc-700 px-3 py-1 font-bold text-zinc-300 hover:border-orange-500" data-phone-renew>
                Cambiar celular
              </button>
            </div>
            {url && <span className="hidden" data-phone-link={url} />}
          </>
        )}
      </div>
    </div>
  );
}
