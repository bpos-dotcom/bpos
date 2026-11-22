"use client";
/**
 * Escanear el código de barras con la cámara del celular, tablet o
 * computadora, para quien no tiene lector. Todo pasa en el equipo: la imagen
 * de la cámara nunca sale de él (no gasta internet ni Supabase).
 *
 * Usa el lector que trae el navegador (BarcodeDetector: Chrome en Android)
 * y, donde no hay (iPhone, Chrome en Windows), una librería que se baja solo
 * la primera vez que se abre la cámara.
 */
import { useEffect, useRef, useState } from "react";
import { cleanScannedCode } from "@/lib/barcode-camera";

type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorClass = { new (opts: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "itf", "codabar", "qr_code"];

/** ¿Este equipo tiene cámara que se pueda usar? (se pregunta el permiso al abrir) */
export function cameraAvailable() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

/** Botón 📷 que abre la cámara; al leer un código llama onCode y se cierra */
export function CameraScanButton({
  onCode,
  label = "📷",
  title = "Escanear con la cámara",
  className = "",
  prompt,
  checkDigit = true,
}: {
  onCode: (code: string) => void;
  label?: string;
  title?: string;
  className?: string;
  /** Texto arriba de la cámara */
  prompt?: string;
  /** false si no es código de producto (tarjeta del club) */
  checkDigit?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [can, setCan] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- solo se sabe en el navegador
    setCan(cameraAvailable());
  }, []);
  if (!can) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={title} aria-label={title} data-camera-scan className={className || "shrink-0 rounded-2xl border border-zinc-700 px-4 py-3 font-black text-zinc-200 hover:border-orange-500"}>
        {label}
      </button>
      {open && (
        <CameraScanner
          prompt={prompt}
          checkDigit={checkDigit}
          onClose={() => setOpen(false)}
          onCode={(code) => {
            setOpen(false);
            onCode(code);
          }}
        />
      )}
    </>
  );
}

export function CameraScanner({ onCode, onClose, prompt = "📷 Apunta al código de barras", checkDigit = true }: { onCode: (code: string) => void; onClose: () => void; prompt?: string; checkDigit?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(true);
  const done = useRef(false);
  const handler = useRef(onCode);
  const checkDigitRef = useRef(checkDigit);
  useEffect(() => {
    handler.current = onCode;
    checkDigitRef.current = checkDigit;
  }, [onCode, checkDigit]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopZxing: (() => void) | null = null;
    let stopped = false;

    const found = (raw: string) => {
      const code = cleanScannedCode(raw, { checkDigit: checkDigitRef.current });
      if (!code || done.current) return;
      done.current = true;
      try {
        navigator.vibrate?.(80);
      } catch {}
      handler.current(code);
    };

    const start = async () => {
      const el = video.current;
      if (!el) return;
      try {
        const Native = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
        const supported = Native ? await Native.getSupportedFormats?.().catch(() => [] as string[]) : [];
        const formats = FORMATS.filter((f) => !supported || supported.includes(f));
        if (Native && formats.length) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
          if (stopped) return;
          el.srcObject = stream;
          await el.play();
          setStarting(false);
          const detector = new Native({ formats });
          const tick = async () => {
            if (stopped || done.current) return;
            try {
              const hits = el.readyState >= 2 ? await detector.detect(el) : [];
              if (hits[0]?.rawValue) return found(hits[0].rawValue);
            } catch {}
            timer = window.setTimeout(tick, 150);
          };
          void tick();
          return;
        }
        // Sin lector del navegador: librería (se baja solo aquí, la primera vez)
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (stopped) return;
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } }, audio: false }, el, (result) => {
          if (result) found(result.getText());
        });
        stopZxing = () => controls.stop();
        if (stopped) stopZxing();
        setStarting(false);
      } catch (e) {
        const name = (e as { name?: string }).name || "";
        setStarting(false);
        setError(
          name === "NotAllowedError" || name === "SecurityError"
            ? "No diste permiso para usar la cámara. Actívalo en el candado de la barra de direcciones (o en los permisos de la app) y vuelve a intentar."
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "Este equipo no tiene cámara."
              : "No se pudo abrir la cámara. Cierra otras apps que la estén usando y vuelve a intentar."
        );
      }
    };
    void start();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      stopZxing?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose} data-camera-scanner>
      <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <p className="font-black text-white">{prompt}</p>
          <button type="button" onClick={onClose} className="rounded-full bg-zinc-800 px-3 py-1 text-lg text-white" aria-label="Cerrar">
            ✕
          </button>
        </div>
        <div className="relative mt-3 aspect-[4/3] overflow-hidden rounded-2xl bg-black">
          <video ref={video} muted playsInline className="h-full w-full object-cover" />
          {!error && <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80 shadow-[0_0_12px_rgba(239,68,68,0.9)]" />}
          {starting && !error && <p className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400">Abriendo la cámara…</p>}
        </div>
        {error ? (
          <p className="mt-3 text-sm font-bold text-red-300">{error}</p>
        ) : (
          <p className="mt-3 text-xs text-zinc-500">Ponlo derecho y con buena luz. La imagen no sale de este equipo.</p>
        )}
      </div>
    </div>
  );
}
