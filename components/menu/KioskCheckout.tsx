"use client";
/**
 * Pagar en el kiosco: el cliente revisa su pedido, dice si es para comer aquí
 * o para llevar, toca Pagar y la terminal Point se enciende con el total. La
 * pantalla pregunta cómo va el cobro cada 2 segundos; al aprobarse muestra el
 * número de pedido y vuelve al inicio.
 *
 * Si el negocio tiene club (Configuración → Club), el cliente puede poner su
 * teléfono para que la compra sume a su cuenta; el campo se vacía con cada
 * pedido.
 */
import { useEffect, useRef, useState } from "react";
import type { KioskEat, OnlineOrderLine } from "@/lib/digital-menu";
import { kioskFetch, setKioskBusy, type KioskSession } from "@/lib/kiosk/client";

type Line = OnlineOrderLine & { key: string };
type Placed = { id: string; folio: string; total: number; status: "esperando" | "pagado" | "fallo"; detail?: string; club?: string; ticket?: boolean };
type Step = "revisar" | "pagando" | "pagado" | "fallo";
/** Club del negocio (Configuración → Club), si está encendido */
type Club = { name: string; kind: "puntos" | "sellos" | "cashback" };
type ClubLookup = { phone: string; member: { name: string; member: boolean } | null };

const CLUB_UNIT: Record<Club["kind"], string> = { puntos: "puntos", sellos: "sellos", cashback: "saldo" };

const money = (n: number) => `$${n.toFixed(2)}`;
/** Segundos que se muestra el número de pedido antes de volver al inicio */
const DONE_SECONDS = 25;

export function KioskCheckout({
  color,
  cart,
  setCart,
  kiosk,
  minOrder,
  onClose,
  onDone,
}: {
  color: string;
  cart: Line[];
  setCart: React.Dispatch<React.SetStateAction<Line[]>>;
  kiosk: KioskSession;
  minOrder: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [eat, setEat] = useState<KioskEat | null>(null);
  const [name, setName] = useState("");
  const [step, setStep] = useState<Step>("revisar");
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(DONE_SECONDS);
  // Club: el número (teléfono) del socio vive solo en esta hoja; al terminar el pedido
  // la hoja se cierra y el siguiente cliente la ve vacía (de un solo uso)
  const [club, setClub] = useState<Club | null>(null);
  const [clubPhone, setClubPhone] = useState("");
  const [clubLookup, setClubLookup] = useState<ClubLookup | null>(null);
  const [flashEat, setFlashEat] = useState(false);
  const eatRef = useRef<HTMLDivElement>(null);

  // ¿El negocio tiene club? Si no, el campo no sale
  useEffect(() => {
    let alive = true;
    kioskFetch<{ club: Club | null }>("/api/kiosco/club")
      .then((r) => alive && setClub(r.club))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Con los 10 dígitos completos se busca al socio para saludarlo (o avisar que no está)
  useEffect(() => {
    if (!club || clubPhone.length !== 10) return;
    let alive = true;
    const timer = setTimeout(() => {
      kioskFetch<{ member: ClubLookup["member"] }>(`/api/kiosco/club?phone=${clubPhone}`)
        .then((r) => alive && setClubLookup({ phone: clubPhone, member: r.member }))
        .catch(() => {});
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [club, clubPhone]);
  const lookup = clubLookup?.phone === clubPhone && clubPhone.length === 10 ? clubLookup : null;

  /** Pago aprobado: número de pedido y cuenta regresiva para volver al inicio */
  function finish(r: Placed) {
    setPlaced(r);
    setLeft(DONE_SECONDS);
    setStep("pagado");
  }

  const total = cart.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const count = cart.reduce((s, l) => s + l.quantity, 0);

  // Mientras se cobra, la pantalla no vuelve sola al inicio
  useEffect(() => {
    setKioskBusy(step === "pagando");
    return () => setKioskBusy(false);
  }, [step]);

  // ¿Ya pagó? Se pregunta al servidor (y él a Mercado Pago) cada 2 s
  useEffect(() => {
    if (step !== "pagando" || !placed) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await kioskFetch<Placed>(`/api/kiosco/pedido?id=${encodeURIComponent(placed.id)}`);
        if (!alive) return;
        if (r.status === "pagado") {
          finish(r);
        } else if (r.status === "fallo") {
          setPlaced(r);
          setStep("fallo");
        }
      } catch {
        // sin internet un momento: se vuelve a preguntar
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [step, placed]);

  // Pagado: cuenta regresiva y de vuelta al inicio
  useEffect(() => {
    if (step !== "pagado") return;
    const timer = setInterval(() => setLeft((n) => n - 1), 1000);
    return () => clearInterval(timer);
  }, [step]);
  useEffect(() => {
    if (step === "pagado" && left <= 0) onDone();
  }, [step, left, onDone]);

  function qty(key: string, delta: number) {
    setCart((c) => c.map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l)).filter((l) => l.quantity > 0));
  }

  async function pay() {
    setError("");
    if (!cart.length) return setError("Tu pedido está vacío.");
    if (!eat) {
      // Parpadea en rojo la pregunta que falta y se desplaza a la vista
      eatRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashEat(false);
      window.setTimeout(() => setFlashEat(true), 20);
      return setError("Dinos si es para comer aquí o para llevar.");
    }
    if (minOrder > 0 && total < minOrder) return setError(`El pedido mínimo es de ${money(minOrder)}.`);
    if (clubPhone && clubPhone.length !== 10) return setError(`Tu número del ${club?.name || "club"} son los 10 dígitos de tu teléfono (o déjalo vacío).`);
    setBusy(true);
    try {
      const r = await kioskFetch<Placed>("/api/kiosco/pedido", {
        method: "POST",
        body: JSON.stringify({
          eat,
          name: name.trim(),
          ...(club && clubPhone.length === 10 ? { club: clubPhone } : {}),
          lines: cart.map(({ productId, quantity, picks, comment }) => ({ productId, quantity, picks, ...(comment ? { comment } : {}) })),
        }),
      });
      setPlaced(r);
      setStep("pagando");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo mandar el cobro a la terminal.");
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    if (!placed) return;
    setBusy(true);
    setError("");
    try {
      const r = await kioskFetch<Placed>("/api/kiosco/pedido", { method: "PATCH", body: JSON.stringify({ id: placed.id }) });
      if (r.status === "pagado") finish(r);
      else {
        setPlaced(r);
        setStep("pagando");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo reintentar.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!placed) return onClose();
    setBusy(true);
    setError("");
    try {
      await kioskFetch(`/api/kiosco/pedido?id=${encodeURIComponent(placed.id)}`, { method: "DELETE" });
      setPlaced(null);
      setStep("revisar");
    } catch (e) {
      // Si justo se aprobó el pago, el pedido sigue: se muestra como pagado
      const r = await kioskFetch<Placed>(`/api/kiosco/pedido?id=${encodeURIComponent(placed.id)}`).catch(() => null);
      if (r?.status === "pagado") finish(r);
      else setError(e instanceof Error ? e.message : "No se pudo cancelar.");
    } finally {
      setBusy(false);
    }
  }

  const big = "w-full rounded-3xl py-5 text-2xl font-black text-white disabled:opacity-40";

  if (step === "pagando" && placed) {
    return (
      <Sheet>
        <p className="text-sm font-black uppercase tracking-widest text-zinc-500">Pedido {placed.folio}</p>
        <h2 className="mt-2 text-4xl font-black">Paga en la terminal</h2>
        <p className="mt-6 text-6xl font-black" style={{ color }}>{money(placed.total)}</p>
        <p className="mt-6 text-xl text-zinc-600">📟 Acerca o inserta tu tarjeta en la terminal que está junto a esta pantalla y sigue sus indicaciones.</p>
        <div className="mt-8 flex items-center justify-center gap-3 text-zinc-500">
          <span className="h-3 w-3 animate-pulse rounded-full" style={{ background: color }} />
          Esperando el pago...
        </div>
        {error && <p className="mt-4 text-lg font-bold text-red-600">{error}</p>}
        <button disabled={busy} onClick={() => void cancel()} className="mt-10 w-full rounded-3xl border-2 border-zinc-300 py-4 text-xl font-black text-zinc-700 disabled:opacity-40">
          {busy ? "..." : "Cancelar"}
        </button>
      </Sheet>
    );
  }

  if (step === "pagado" && placed) {
    return (
      <Sheet>
        <p className="text-6xl">✅</p>
        <h2 className="mt-3 text-4xl font-black">¡Pago aprobado!</h2>
        <p className="mt-6 text-sm font-black uppercase tracking-widest text-zinc-500">Tu número de pedido</p>
        <p className="mt-1 text-8xl font-black tracking-[0.2em]" style={{ color }}>{placed.folio}</p>
        {placed.ticket && <p className="mt-4 text-xl font-black">🧾 Toma tu ticket de la impresora.</p>}
        <p className="mt-6 text-xl text-zinc-600">
          {eat === "aqui" ? "Toma asiento: te llamamos con tu número cuando esté listo." : "Te llamamos con tu número cuando esté listo para llevar."}
          {name.trim() ? ` Gracias, ${name.trim().split(" ")[0]}.` : ""}
        </p>
        {placed.club !== undefined && club && (
          <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-lg font-bold text-amber-800">
            ⭐ {club.name}: esta compra suma {CLUB_UNIT[club.kind]} a la cuenta de {placed.club.trim().split(" ")[0] || "tu cuenta"}.
          </p>
        )}
        <button onClick={onDone} className={`${big} mt-10`} style={{ background: color }}>
          Listo ({left}s)
        </button>
      </Sheet>
    );
  }

  if (step === "fallo" && placed) {
    return (
      <Sheet>
        <p className="text-6xl">😕</p>
        <h2 className="mt-3 text-4xl font-black">No se completó el pago</h2>
        <p className="mt-3 text-xl text-zinc-600">{placed.detail || "La terminal no confirmó el pago."}</p>
        <p className="mt-6 text-5xl font-black" style={{ color }}>{money(placed.total)}</p>
        {error && <p className="mt-4 text-lg font-bold text-red-600">{error}</p>}
        <button disabled={busy} onClick={() => void retry()} className={`${big} mt-8`} style={{ background: color }}>
          {busy ? "..." : "Intentar de nuevo"}
        </button>
        <button disabled={busy} onClick={() => void cancel()} className="mt-3 w-full rounded-3xl border-2 border-zinc-300 py-4 text-xl font-black text-zinc-700 disabled:opacity-40">
          Cancelar pedido
        </button>
      </Sheet>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-6 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-3xl font-black">Tu pedido ({count})</h2>
          <button onClick={onClose} className="rounded-full bg-zinc-100 px-5 py-2 text-2xl" aria-label="Seguir pidiendo">✕</button>
        </div>
        <div className="mt-3 divide-y divide-zinc-100">
          {cart.map((l) => (
            <div key={l.key} className="flex items-center gap-4 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-xl font-black">{l.name}</p>
                {l.summary && <p className="text-sm text-zinc-500">{l.summary}</p>}
                {l.comment && <p className="text-sm italic text-zinc-500">“{l.comment}”</p>}
                <p className="font-bold" style={{ color }}>{money(l.unitPrice * l.quantity)}</p>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => qty(l.key, -1)} className="h-14 w-14 rounded-full bg-zinc-100 text-2xl font-black" aria-label="Quitar uno">−</button>
                <span className="w-8 text-center text-2xl font-black">{l.quantity}</span>
                <button onClick={() => qty(l.key, 1)} className="h-14 w-14 rounded-full bg-zinc-100 text-2xl font-black" aria-label="Agregar uno">+</button>
              </div>
            </div>
          ))}
        </div>
        {cart.length === 0 && <p className="py-8 text-center text-xl text-zinc-500">Tu pedido está vacío.</p>}

        <div ref={eatRef} onAnimationEnd={() => setFlashEat(false)} className={`mt-5 rounded-3xl ${flashEat ? "menu-flash" : ""}`}>
        <p className={`text-lg font-black ${flashEat ? "text-red-600" : ""}`}>¿Dónde lo vas a comer?</p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {(
            [
              ["aqui", "🍽️ Para comer aquí"],
              ["llevar", "🛍️ Para llevar"],
            ] as const
          ).map(([k, text]) => (
            <button
              key={k}
              onClick={() => setEat(k)}
              className="rounded-3xl border-2 py-6 text-xl font-black"
              style={eat === k ? { background: color, borderColor: color, color: "#fff" } : { borderColor: "#e4e4e7" }}
            >
              {text}
            </button>
          ))}
        </div>
        </div>

        <label className="mt-5 block text-lg font-black">
          Tu nombre <span className="text-sm font-bold text-zinc-500">(opcional, para llamarte)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="mt-1 w-full rounded-2xl border-2 border-zinc-200 px-5 py-4 text-xl" />
        </label>

        {club && (
          <label className="mt-5 block text-lg font-black">
            ⭐ Tu número del {club.name} <span className="text-sm font-bold text-zinc-500">(opcional: tu teléfono, para sumar {CLUB_UNIT[club.kind]})</span>
            <input
              type="tel"
              inputMode="numeric"
              value={clubPhone}
              onChange={(e) => setClubPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              maxLength={10}
              placeholder="10 dígitos"
              autoComplete="off"
              className="mt-1 w-full rounded-2xl border-2 border-zinc-200 px-5 py-4 text-xl tracking-widest"
            />
            {lookup && lookup.member && (
              <span className="mt-2 block text-base font-bold text-emerald-700">
                ✅ Hola{lookup.member.name.trim() ? `, ${lookup.member.name.trim().split(" ")[0]}` : ""}.{" "}
                {lookup.member.member ? `Esta compra suma a tu ${club.name}.` : `Aún no te has unido al ${club.name}: únete desde tu cuenta en el menú digital y la próxima compra ya suma.`}
              </span>
            )}
            {lookup && !lookup.member && (
              <span className="mt-2 block text-base font-bold text-amber-700">
                No encontramos ese número. Regístrate en el menú digital de {kiosk.business.name} con tu teléfono para juntar {CLUB_UNIT[club.kind]}. Puedes seguir sin él.
              </span>
            )}
          </label>
        )}

        <div className="mt-6 flex items-center justify-between border-t border-zinc-100 pt-5">
          <span className="text-2xl font-black">Total</span>
          <span className="text-4xl font-black" style={{ color }}>{money(total)}</span>
        </div>
        {error && <p className="mt-3 text-lg font-bold text-red-600">{error}</p>}
        <button disabled={busy || cart.length === 0} onClick={() => void pay()} className={`${big} mt-4`} style={{ background: eat ? color : "#a1a1aa" }}>
          {busy ? "Encendiendo la terminal..." : `💳 Pagar en la terminal · ${money(total)}`}
        </button>
        <button onClick={onClose} className="mt-3 w-full rounded-3xl border-2 border-zinc-200 py-4 text-xl font-black text-zinc-700">
          Seguir pidiendo
        </button>
        <p className="mt-3 text-center text-sm text-zinc-400">Pagas con tarjeta en la terminal Mercado Pago · {kiosk.business.name}</p>
      </div>
    </div>
  );
}

function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-3xl bg-white p-8 text-center">{children}</div>
    </div>
  );
}
