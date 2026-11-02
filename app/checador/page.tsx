"use client";
/**
 * Checador de entrada y salida: pantalla para la tablet o computadora del
 * local. El empleado toca su nombre, escribe su PIN de B-POS y queda
 * registrada su entrada o su salida (lo que le toque). No necesita que
 * nadie haya iniciado sesión en el POS. Reporte en Configuración → Asistencia.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/layout/TopCorner";
import { addAuditEvent } from "@/lib/audit";
import { getBusinessSettings } from "@/lib/business-settings";
import { verifyPin } from "@/lib/pin-hash";
import { addPunch, lastPunch, nextPunchType, TIMECLOCK_EVENT, type Punch, type PunchType } from "@/lib/timeclock";
import { getUsers, migrateUserPins, type SystemUser } from "@/lib/users";

const time = (iso: string) => new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

export default function ChecadorPage() {
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [brand, setBrand] = useState("B-POS");
  const [selected, setSelected] = useState<SystemUser | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ user: SystemUser; punch: Punch } | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [, setVersion] = useState(0);

  useEffect(() => {
    const load = () => setUsers(getUsers().filter((u) => u.active));
    void migrateUserPins().then(load);
    setBrand(getBusinessSettings().businessName || "B-POS");
    const tick = () => setNow(new Date());
    tick();
    const timer = setInterval(tick, 10_000);
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener("bpos:users-updated", load);
    window.addEventListener(TIMECLOCK_EVENT, bump);
    window.addEventListener("storage", bump);
    return () => {
      clearInterval(timer);
      window.removeEventListener("bpos:users-updated", load);
      window.removeEventListener(TIMECLOCK_EVENT, bump);
      window.removeEventListener("storage", bump);
    };
  }, []);

  // El aviso de "registrado" se quita solo y regresa a la lista
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), 4000);
    return () => clearTimeout(t);
  }, [done]);

  async function confirm(code = pin) {
    if (!selected) return;
    const user = getUsers().find((u) => u.id === selected.id) || selected;
    const ok = await verifyPin(code, user);
    if (!ok) {
      setError("PIN incorrecto.");
      setPin("");
      addAuditEvent({ category: "Seguridad", action: "timeclock.failed", description: `PIN incorrecto en el checador para ${user.name}`, entityId: String(user.id), metadata: { userName: user.name } });
      return;
    }
    const type: PunchType = nextPunchType(user.id);
    const punch = addPunch({ id: user.id, name: user.name }, type);
    addAuditEvent({ category: "Seguridad", action: `timeclock.${type}`, description: `${user.name} marcó ${type} a las ${time(punch.at)}`, userId: String(user.id), userName: user.name, entityId: punch.id });
    setDone({ user, punch });
    setSelected(null);
    setPin("");
    setError("");
  }

  function press(d: string) {
    if (pin.length >= 8) return;
    const next = pin + d;
    setPin(next);
    setError("");
  }

  const pending = selected ? nextPunchType(selected.id) : "entrada";

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-black p-4 text-white sm:p-6">
      <div className="absolute right-4 top-4 flex items-center gap-2">
        <ThemeToggle />
        <Link href="/login" className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm font-black hover:border-orange-500">
          Ir al sistema
        </Link>
      </div>
      <section className="w-full max-w-2xl rounded-3xl border border-zinc-800 bg-zinc-950 p-6 sm:p-8">
        <div className="text-center">
          <p className="text-sm font-black text-orange-500">{brand}</p>
          <h1 className="mt-1 text-3xl font-black">⏱️ Checador</h1>
          {now && (
            <p className="mt-2 text-4xl font-black tabular-nums">
              {now.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}
              <span className="ml-3 text-base font-bold capitalize text-zinc-400">{now.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}</span>
            </p>
          )}
        </div>

        {done ? (
          <div className={`mt-8 rounded-3xl border p-8 text-center ${done.punch.type === "entrada" ? "border-emerald-500/60 bg-emerald-500/10" : "border-orange-500/60 bg-orange-500/10"}`}>
            <p className="text-6xl">{done.punch.type === "entrada" ? "✅" : "👋"}</p>
            <h2 className="mt-3 text-3xl font-black">
              {done.user.name}: {done.punch.type === "entrada" ? "entrada" : "salida"} registrada
            </h2>
            <p className="mt-1 text-xl font-bold text-zinc-300">{time(done.punch.at)}</p>
            <button onClick={() => setDone(null)} className="mt-5 rounded-2xl border border-zinc-700 px-5 py-2 text-sm font-black">
              Listo
            </button>
          </div>
        ) : !selected ? (
          <>
            <p className="mt-6 text-center text-zinc-400">Toca tu nombre para marcar tu entrada o tu salida.</p>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {users.map((user) => {
                const last = lastPunch(user.id);
                const next = nextPunchType(user.id);
                return (
                  <button key={user.id} onClick={() => { setSelected(user); setPin(""); setError(""); }} className="rounded-2xl border border-zinc-800 bg-black p-4 text-left transition hover:border-orange-500">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl ${next === "salida" ? "bg-emerald-500/20" : "bg-zinc-900"}`}>{next === "salida" ? "🟢" : "👤"}</div>
                      <div className="min-w-0">
                        <p className="truncate text-lg font-black">{user.name}</p>
                        <p className="text-xs text-zinc-500">
                          {next === "salida" && last ? `Entró a las ${time(last.at)} · tocar para marcar salida` : last ? `Última salida ${time(last.at)} · tocar para marcar entrada` : "Tocar para marcar entrada"}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {users.length === 0 && <p className="mt-6 rounded-2xl border border-dashed border-zinc-800 p-6 text-center text-zinc-500">No hay empleados activos. Agrégalos en Configuración → Usuarios.</p>}
          </>
        ) : (
          <>
            <button onClick={() => { setSelected(null); setPin(""); setError(""); }} className="mt-6 rounded-2xl border border-zinc-800 bg-black px-4 py-2 text-sm font-bold text-zinc-400 hover:border-orange-500 hover:text-orange-500">
              ← Otro empleado
            </button>
            <div className="mt-4 text-center">
              <h2 className="text-2xl font-black">{selected.name}</h2>
              <p className={`mt-1 font-black ${pending === "entrada" ? "text-emerald-400" : "text-orange-400"}`}>{pending === "entrada" ? "Marcar ENTRADA" : "Marcar SALIDA"} · escribe tu PIN</p>
              <p className="mt-4 h-10 text-4xl font-black tracking-[0.5em]">{"●".repeat(pin.length)}</p>
              {error && <p className="text-sm font-bold text-red-400">{error}</p>}
            </div>
            <div className="mx-auto mt-4 grid max-w-xs grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button key={d} onClick={() => press(d)} className="h-16 rounded-2xl border border-zinc-800 bg-black text-2xl font-black hover:border-orange-500">
                  {d}
                </button>
              ))}
              <button onClick={() => setPin(pin.slice(0, -1))} className="h-16 rounded-2xl border border-zinc-800 bg-black text-xl font-black text-zinc-400">
                ⌫
              </button>
              <button onClick={() => press("0")} className="h-16 rounded-2xl border border-zinc-800 bg-black text-2xl font-black hover:border-orange-500">
                0
              </button>
              <button onClick={() => void confirm()} disabled={pin.length < 4} className={`h-16 rounded-2xl text-xl font-black text-black disabled:opacity-40 ${pending === "entrada" ? "bg-emerald-400" : "bg-orange-500"}`}>
                ✓
              </button>
            </div>
            <input
              value={pin}
              onChange={(e) => { setPin(e.target.value.replace(/\D/g, "").slice(0, 8)); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && pin.length >= 4 && void confirm()}
              type="password"
              inputMode="numeric"
              autoFocus
              aria-label="PIN"
              className="mx-auto mt-3 block w-40 rounded-xl border border-zinc-800 bg-black px-3 py-2 text-center text-white"
              placeholder="o con teclado"
            />
          </>
        )}
      </section>
    </main>
  );
}
