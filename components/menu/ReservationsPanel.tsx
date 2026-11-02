"use client";
/**
 * Pedidos en línea → Reservaciones: las que llegan del menú digital.
 * Nuevas (confirmar / rechazar con motivo, avisando por WhatsApp) y las
 * próximas confirmadas (marcar que llegó o que no llegó).
 */
import { useCallback, useEffect, useState } from "react";
import { getCurrentUser } from "@/lib/auth";
import { DIGITAL_MENU_EVENT, getDigitalMenu, whatsappNumber } from "@/lib/digital-menu";
import { listReservations, RESERVATIONS_EVENT, reservationWhatsappLink, reservationWhen, setReservationStatus, type Reservation } from "@/lib/reservations";

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

function Card({ r, onChanged }: { r: Reservation; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);
  const [now] = useState(() => Date.now());
  const today = sameDay(new Date(r.reserved_at), new Date(now));
  const past = Date.parse(r.reserved_at) < now - 2 * 3600_000;

  async function change(status: "confirmada" | "rechazada" | "llego" | "no_llego") {
    const by = getCurrentUser().name;
    // WhatsApp se abre en el mismo clic (si no, el navegador lo bloquea)
    const link = status === "confirmada" || status === "rechazada" ? reservationWhatsappLink(r, status, reason.trim()) : "";
    const win = link && getDigitalMenu().whatsappNotify ? window.open(link, "_blank") : null;
    setBusy(true);
    try {
      await setReservationStatus(r.id, status, reason.trim(), by);
      onChanged();
    } catch (e) {
      win?.close();
      alert(e instanceof Error ? e.message : "No se pudo.");
    }
    setBusy(false);
    setAsking(false);
  }

  return (
    <div className={`rounded-2xl border p-4 ${r.status === "nueva" ? "border-amber-400/60 bg-amber-500/10" : today ? "border-emerald-500/50 bg-emerald-500/5" : "border-zinc-800 bg-black"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-black">
            {r.customer_name} · {r.people} {r.people === 1 ? "persona" : "personas"}
          </p>
          <p className="text-sm capitalize text-zinc-300">{reservationWhen(r.reserved_at)}</p>
          {r.note && <p className="mt-1 text-sm text-zinc-400">📝 {r.note}</p>}
          <p className="mt-1 text-xs text-zinc-500">
            {r.customer_phone ? `📱 ${r.customer_phone}` : ""}
            {r.status !== "nueva" ? ` · ${r.status}${r.attended_by ? ` por ${r.attended_by}` : ""}` : ""}
          </p>
        </div>
        {r.customer_phone && whatsappNumber(r.customer_phone) && (
          <a href={`https://wa.me/${whatsappNumber(r.customer_phone)}`} target="_blank" rel="noreferrer" className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-black text-emerald-300">
            WhatsApp
          </a>
        )}
      </div>
      {r.status === "nueva" && !asking && (
        <div className="mt-3 flex gap-2">
          <button onClick={() => change("confirmada")} disabled={busy} className="flex-1 rounded-xl bg-emerald-500 py-2 font-black text-black disabled:opacity-50">
            ✅ Confirmar
          </button>
          <button onClick={() => setAsking(true)} disabled={busy} className="rounded-xl border border-red-500/50 px-4 py-2 font-black text-red-300 disabled:opacity-50">
            Rechazar
          </button>
        </div>
      )}
      {asking && (
        <div className="mt-3 flex gap-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (ej. lleno a esa hora)" className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-black px-3 py-2 text-sm text-white" />
          <button onClick={() => change("rechazada")} disabled={busy} className="rounded-xl bg-red-500 px-4 py-2 font-black text-black disabled:opacity-50">
            Rechazar
          </button>
          <button onClick={() => setAsking(false)} className="rounded-xl border border-zinc-700 px-3 py-2 text-sm font-black">
            ✕
          </button>
        </div>
      )}
      {r.status === "confirmada" && (today || past) && (
        <div className="mt-3 flex gap-2">
          <button onClick={() => change("llego")} disabled={busy} className="flex-1 rounded-xl border border-emerald-500/60 py-2 text-sm font-black text-emerald-300 disabled:opacity-50">
            🍽️ Ya llegó
          </button>
          <button onClick={() => change("no_llego")} disabled={busy} className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-black text-zinc-400 disabled:opacity-50">
            No llegó
          </button>
        </div>
      )}
    </div>
  );
}

export function ReservationsPanel() {
  const [list, setList] = useState<Reservation[] | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setList(await listReservations());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las reservaciones.");
    }
  }, []);

  useEffect(() => {
    const sync = () => {
      const m = getDigitalMenu();
      setEnabled(m.enabled && m.reservations.enabled);
    };
    sync();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga de la nube: solo después de montar
    void load();
    const timer = setInterval(() => {
      setNow(Date.now());
      void load();
    }, 30_000);
    const reload = () => void load();
    window.addEventListener(RESERVATIONS_EVENT, reload);
    window.addEventListener(DIGITAL_MENU_EVENT, sync);
    return () => {
      clearInterval(timer);
      window.removeEventListener(RESERVATIONS_EVENT, reload);
      window.removeEventListener(DIGITAL_MENU_EVENT, sync);
    };
  }, [load]);

  const fresh = (list || []).filter((r) => r.status === "nueva");
  const upcoming = (list || []).filter((r) => r.status === "confirmada" && Date.parse(r.reserved_at) > now - 2 * 3600_000);
  if (!enabled && fresh.length === 0 && upcoming.length === 0) return null;

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-black">
          📅 Reservaciones{fresh.length ? <span className="ml-2 rounded-full bg-amber-400 px-2 py-0.5 text-xs font-black text-black">{fresh.length} por confirmar</span> : null}
        </h2>
        <p className="text-xs text-zinc-500">Las piden desde tu menú digital. Al confirmar o rechazar se abre WhatsApp con el aviso.</p>
      </div>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      {list && fresh.length === 0 && upcoming.length === 0 && <p className="mt-3 text-sm text-zinc-500">Sin reservaciones pendientes ni próximas.</p>}
      {fresh.length > 0 && (
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {fresh.map((r) => (
            <Card key={r.id} r={r} onChanged={() => void load()} />
          ))}
        </div>
      )}
      {upcoming.length > 0 && (
        <>
          <h3 className="mt-4 text-sm font-black text-zinc-400">Próximas confirmadas ({upcoming.length})</h3>
          <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {upcoming.map((r) => (
              <Card key={r.id} r={r} onChanged={() => void load()} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
