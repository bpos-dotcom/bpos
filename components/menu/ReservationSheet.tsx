"use client";
import { ask } from "@/components/layout/Dialogs";
/**
 * Reservar mesa desde el menú digital: nombre, WhatsApp, día, hora,
 * personas y nota. Se guarda con bpos_menu_reserve (migración 0024) y el
 * cliente ve aquí mismo si el negocio ya la confirmó (se guarda la llave en
 * este teléfono para volver a consultarla).
 */
import { useEffect, useState } from "react";
import type { DigitalMenuSettings } from "@/lib/digital-menu";
import { getSupabase } from "@/lib/supabase/client";

type Saved = { id: string; token: string; at: string; people: number };
type Status = { status: string; reason: string; reserved_at: string; people: number };

const field = "w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-zinc-900 placeholder:text-zinc-400";
const label = "block text-sm font-bold text-zinc-600";
const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const STATUS_TEXT: Record<string, { icon: string; text: string; cls: string }> = {
  nueva: { icon: "⏳", text: "Recibida. El restaurante la confirma en breve; te avisará por WhatsApp.", cls: "bg-amber-50 text-amber-800" },
  confirmada: { icon: "✅", text: "¡Confirmada! Te esperamos.", cls: "bg-emerald-50 text-emerald-800" },
  rechazada: { icon: "😔", text: "No se pudo confirmar. Escríbenos y buscamos otra hora.", cls: "bg-red-50 text-red-800" },
  cancelada: { icon: "✖️", text: "Cancelada.", cls: "bg-zinc-100 text-zinc-700" },
  llego: { icon: "🍽️", text: "¡Gracias por tu visita!", cls: "bg-emerald-50 text-emerald-800" },
  no_llego: { icon: "ℹ️", text: "La reservación venció.", cls: "bg-zinc-100 text-zinc-700" },
};

export function ReservationSheet({ slug, settings, color, onClose }: { slug: string; settings: DigitalMenuSettings["reservations"]; color: string; onClose: () => void }) {
  const key = `bpos-reserva:${slug}`;
  const [saved, setSaved] = useState<Saved | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState(() => localDate(new Date()));
  const [time, setTime] = useState("");
  const [people, setPeople] = useState(2);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [opened] = useState(() => new Date());

  // Una reservación hecha desde este teléfono: se vuelve a mostrar hasta que pase
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(key) || "null") as Saved | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- dato guardado en el teléfono: solo después de montar
      if (s && Date.parse(s.at) > Date.now() - 6 * 3600_000) setSaved(s);
      else localStorage.removeItem(key);
    } catch {}
  }, [key]);

  useEffect(() => {
    if (!saved) return;
    let alive = true;
    const check = async () => {
      const { data } = await getSupabase().rpc("bpos_menu_reservation_status", { p_id: saved.id, p_token: saved.token });
      if (alive && data) setStatus(data as Status);
    };
    void check();
    const t = setInterval(() => void check(), 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [saved]);

  const minDate = localDate(opened);
  const maxDate = localDate(new Date(opened.getTime() + settings.maxDays * 86400_000));

  async function send() {
    setError("");
    if (name.trim().length < 2) return setError("Escribe tu nombre.");
    if (phone.replace(/\D/g, "").length < 10) return setError("Escribe tu WhatsApp a 10 dígitos.");
    if (!date || !time) return setError("Elige el día y la hora.");
    const at = new Date(`${date}T${time}:00`);
    if (Number.isNaN(at.getTime())) return setError("Fecha u hora no válida.");
    if (at.getTime() < Date.now() + 30 * 60_000) return setError("Elige una hora con al menos 30 minutos de anticipación.");
    setBusy(true);
    try {
      const { data, error: e } = await getSupabase().rpc("bpos_menu_reserve", {
        p_slug: slug,
        p_reservation: { name: name.trim(), phone: phone.replace(/\D/g, ""), people, at: at.toISOString(), note: note.trim() },
      });
      if (e) throw new Error(e.message);
      const res = data as { id: string; token: string };
      const s: Saved = { id: res.id, token: res.token, at: at.toISOString(), people };
      try {
        localStorage.setItem(key, JSON.stringify(s));
      } catch {}
      setSaved(s);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^.*?:\s*/, "") : "No se pudo enviar. Intenta otra vez.");
    }
    setBusy(false);
  }

  async function cancel() {
    if (!saved || !(await ask("¿Cancelar tu reservación?", { ok: "Sí, cancelar", cancel: "No" }))) return;
    await getSupabase().rpc("bpos_menu_reservation_cancel", { p_id: saved.id, p_token: saved.token });
    try {
      localStorage.removeItem(key);
    } catch {}
    setSaved(null);
    setStatus(null);
  }

  const st = status ? STATUS_TEXT[status.status] || STATUS_TEXT.nueva : STATUS_TEXT.nueva;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <section className="max-h-[94dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 text-zinc-900 shadow-2xl sm:rounded-3xl sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-2xl font-black">📅 Reservar mesa</h2>
          <button onClick={onClose} className="rounded-xl border border-zinc-200 px-3 py-1.5 font-black" aria-label="Cerrar">
            ✕
          </button>
        </div>

        {saved ? (
          <div className="mt-4">
            <div className={`rounded-2xl p-4 ${st.cls}`}>
              <p className="text-3xl">{st.icon}</p>
              <p className="mt-1 font-black">
                Mesa para {saved.people} · {new Date(saved.at).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })} a las {new Date(saved.at).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" })}
              </p>
              <p className="mt-1 text-sm">{st.text}</p>
              {status?.reason && <p className="mt-1 text-sm">Motivo: {status.reason}</p>}
            </div>
            {settings.note && <p className="mt-3 text-sm text-zinc-600">{settings.note}</p>}
            {(!status || status.status === "nueva" || status.status === "confirmada") && (
              <button onClick={cancel} className="mt-4 w-full rounded-2xl border border-zinc-300 py-3 text-sm font-black text-zinc-600">
                Cancelar mi reservación
              </button>
            )}
            <button onClick={onClose} className="mt-2 w-full rounded-2xl py-3 font-black text-white" style={{ background: color }}>
              Listo
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {settings.note && <p className="rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-700">{settings.note}</p>}
            <label className={label}>
              Tu nombre
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Nombre" autoComplete="name" className={`${field} mt-1`} />
            </label>
            <label className={label}>
              WhatsApp (ahí te confirmamos)
              <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="10 dígitos" className={`${field} mt-1`} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className={label}>
                Día
                <input type="date" value={date} min={minDate} max={maxDate} onChange={(e) => setDate(e.target.value)} className={`${field} mt-1`} />
              </label>
              <label className={label}>
                Hora
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={`${field} mt-1`} />
              </label>
            </div>
            <div>
              <span className={label}>¿Cuántas personas?</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {Array.from({ length: Math.min(8, settings.maxPeople) }, (_, i) => i + 1).map((n) => (
                  <button key={n} onClick={() => setPeople(n)} className="h-11 w-11 rounded-xl border font-black" style={people === n ? { background: color, borderColor: color, color: "#fff" } : { borderColor: "#e4e4e7" }}>
                    {n}
                  </button>
                ))}
                {settings.maxPeople > 8 && (
                  <input type="number" min={1} max={settings.maxPeople} value={people} onChange={(e) => setPeople(Math.max(1, Math.min(settings.maxPeople, Number(e.target.value) || 1)))} className="h-11 w-20 rounded-xl border border-zinc-200 px-2 text-center font-black" aria-label="Personas" />
                )}
              </div>
            </div>
            <label className={label}>
              Nota (opcional)
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Cumpleaños, silla para bebé, terraza..." className={`${field} mt-1`} />
            </label>
            {error && <p className="text-sm font-bold text-red-600">{error}</p>}
            <button onClick={send} disabled={busy} className="w-full rounded-2xl py-4 font-black text-white disabled:opacity-50" style={{ background: color }}>
              {busy ? "Enviando..." : "Reservar"}
            </button>
            <p className="text-center text-xs text-zinc-500">El restaurante confirma tu reservación y te avisa por WhatsApp.</p>
          </div>
        )}
      </section>
    </div>
  );
}
