"use client";
/**
 * Kiosco de autoservicio: bpos.com.mx/kiosco
 *
 * Es el menú digital de la sucursal en una pantalla táctil del local. La
 * primera vez pide el correo de una cuenta del negocio y el código de
 * vinculación (Configuración → Menú digital → Pantalla en el local); después
 * abre solo. El cliente toca "Toca para ordenar", arma su pedido y paga en la
 * terminal Point asignada a esta pantalla. Sin tocar la pantalla un rato,
 * vuelve al inicio y se vacía el pedido.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { PublicMenu } from "@/components/menu/PublicMenu";
import { TouchKeyboard } from "@/components/menu/TouchKeyboard";
import { KIOSK_BUSY_EVENT, kioskFetch, readKioskSession, saveKioskSession, type KioskSession } from "@/lib/kiosk/client";

/** Segundos sin tocar la pantalla para volver al inicio */
const IDLE_SECONDS = 90;

type Status = { slug: string; name: string; business: KioskSession["business"]; branch: string; terminal: boolean; theme: "light" | "dark" };

export default function KioskPage() {
  const [session, setSession] = useState<KioskSession | null | undefined>(undefined);
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    // Pantalla táctil: todo un poco más grande, y siempre en claro
    document.documentElement.classList.remove("theme-light");
    document.documentElement.classList.add("kiosk");
    const previous = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = "19px";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- llave guardada en este equipo: solo después de montar
    setSession(readKioskSession());
    return () => {
      document.documentElement.style.fontSize = previous;
      document.documentElement.classList.remove("kiosk");
    };
  }, []);

  // Cada minuto: "sigo aquí" (última señal en Configuración) y si la desvincularon, de vuelta a vincular
  const check = useCallback(async () => {
    try {
      const s = await kioskFetch<Status & { success: true }>("/api/kiosco");
      setStatus(s);
      setSession((cur) => (cur ? { ...cur, slug: s.slug || cur.slug, name: s.name, business: s.business, branch: s.branch } : cur));
    } catch (e) {
      if ((e as { status?: number }).status === 401) {
        saveKioskSession(null);
        setSession(null);
      }
    }
  }, []);
  useEffect(() => {
    if (!session) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- estado de la pantalla: se pregunta al servidor al montar
    void check();
    const timer = setInterval(() => void check(), 60_000);
    return () => clearInterval(timer);
  }, [session?.token, check]); // eslint-disable-line react-hooks/exhaustive-deps -- solo cuando cambia la llave

  if (session === undefined) return <div className="min-h-screen bg-[#fff8f1]" />;
  return (
    <>
      {session ? (
        <Kiosk session={session} status={status} />
      ) : (
        <Pair
          onPaired={(s) => {
            saveKioskSession(s);
            setSession(s);
          }}
        />
      )}
      {/* Pantalla táctil sin teclado: teclado en pantalla al tocar un campo */}
      <TouchKeyboard />
    </>
  );
}

// ------------------------------------------------------------ vincular

function Pair({ onPaired }: { onPaired: (s: KioskSession) => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = await kioskFetch<KioskSession & { success: true }>("/api/kiosco", { method: "POST", body: JSON.stringify({ email, code, name }) });
      onPaired({ token: r.token, kioskId: r.kioskId, name: r.name, slug: r.slug, business: r.business, branch: r.branch });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo vincular.");
    } finally {
      setBusy(false);
    }
  }

  const field = "mt-1 w-full rounded-2xl border-2 border-zinc-200 px-5 py-4 text-xl outline-none focus:border-orange-400";
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fff8f1] p-6 text-zinc-900 [color-scheme:light]">
      <form onSubmit={(e) => void submit(e)} className="w-full max-w-lg rounded-3xl border border-orange-100 bg-white p-8 shadow-xl">
        <p className="text-xs font-black uppercase tracking-[0.3em] text-orange-500">B-POS · Kiosco</p>
        <h1 className="mt-2 text-3xl font-black">Vincular esta pantalla</h1>
        <p className="mt-2 text-zinc-500">
          En B-POS entra a <b>Configuración → Menú digital → Pantalla en el local</b>, genera un código y escríbelo aquí junto con el correo de tu cuenta.
        </p>
        <label className="mt-6 block text-sm font-black">
          Correo de la cuenta del negocio
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" inputMode="email" required className={field} />
        </label>
        <label className="mt-4 block text-sm font-black">
          Código de vinculación
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            pattern="[0-9]{6}"
            placeholder="000000"
            required
            className={`${field} text-center font-mono text-3xl tracking-[0.4em]`}
          />
        </label>
        <label className="mt-4 block text-sm font-black">
          Nombre de esta pantalla <span className="font-bold text-zinc-400">(opcional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Ej. Kiosco entrada" className={field} />
        </label>
        {error && <p className="mt-4 font-bold text-red-600">{error}</p>}
        <button disabled={busy || code.length !== 6 || !email} className="mt-6 w-full rounded-2xl bg-orange-500 py-4 text-xl font-black text-white disabled:opacity-40">
          {busy ? "Vinculando..." : "Vincular pantalla"}
        </button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------ pantalla

function Kiosk({ session, status }: { session: KioskSession; status: Status | null }) {
  const [idle, setIdle] = useState(true);
  /** Cambia para volver a montar el menú (pedido vacío) */
  const [round, setRound] = useState(0);
  const busy = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const color = session.business.color || "#f97316";

  const goIdle = useCallback(() => {
    setIdle(true);
    setRound((n) => n + 1);
  }, []);

  useEffect(() => {
    const arm = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (busy.current) arm();
        else goIdle();
      }, IDLE_SECONDS * 1000);
    };
    const onBusy = (e: Event) => {
      busy.current = Boolean((e as CustomEvent<boolean>).detail);
      arm();
    };
    const events: (keyof WindowEventMap)[] = ["pointerdown", "touchstart", "keydown", "scroll", "wheel"];
    for (const ev of events) window.addEventListener(ev, arm, { passive: true });
    window.addEventListener(KIOSK_BUSY_EVENT, onBusy);
    arm();
    return () => {
      window.clearTimeout(timer.current);
      for (const ev of events) window.removeEventListener(ev, arm);
      window.removeEventListener(KIOSK_BUSY_EVENT, onBusy);
    };
  }, [goIdle]);

  // Sin terminal asignada, el kiosco no puede cobrar: aviso para el personal (el cliente no debería ver esto)
  const noTerminal = status ? !status.terminal : false;
  const dark = status?.theme === "dark";

  return (
    <div className={`min-h-screen bg-[#fff8f1] text-zinc-900 ${dark ? "menu-dark [color-scheme:dark]" : "[color-scheme:light]"}`}>
      {noTerminal && (
        <p className="sticky top-0 z-50 bg-red-600 px-4 py-2 text-center text-sm font-black text-white">
          Esta pantalla no tiene terminal Point asignada: asígnala en Configuración → Menú digital → Pantalla en el local.
        </p>
      )}
      {idle ? (
        <button onClick={() => setIdle(false)} className="flex min-h-screen w-full flex-col items-center justify-center gap-8 p-8 text-center" style={{ background: `linear-gradient(160deg, ${dark ? "#0c0c0e" : "#fff8f1"} 0%, ${color}${dark ? "33" : "22"} 100%)` }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- logo del negocio */}
          <img src={session.business.logo || "/bpos-logo.png"} alt="" className="h-40 w-40 rounded-3xl bg-white object-contain p-3 shadow-xl" />
          <div>
            <h1 className="text-5xl font-black uppercase tracking-tight">{session.business.name}</h1>
            {session.branch && <p className="mt-2 text-xl text-zinc-500">{session.branch}</p>}
          </div>
          <span className="animate-pulse rounded-full px-12 py-6 text-3xl font-black text-white shadow-2xl" style={{ background: color }}>
            👆 Toca para ordenar
          </span>
          <p className="text-lg text-zinc-500">Pide aquí y paga con tarjeta en la terminal</p>
        </button>
      ) : (
        <PublicMenu key={round} slug={session.slug} kiosk={session} onKioskDone={goIdle} />
      )}
    </div>
  );
}
