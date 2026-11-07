"use client";
/**
 * bpos.com.mx/servicios/login: entrada de B-POS Servicios. El restaurante
 * entra con su correo y contraseña (la misma cuenta de B-POS) o crea una
 * cuenta eligiendo qué servicios quiere probar; después abre /servicios con
 * el panel de lo que tiene contratado.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { signIn } from "@/lib/cloud/account";
import { getSupabase, isCloudConfigured } from "@/lib/supabase/client";
import { SignupForm } from "@/components/cloud/SignupForm";
import { SERVICES, mergeCatalog, money, type CatalogEntry, type ServiceId } from "@/lib/services";
import { servicesCall } from "@/lib/services-client";

const input = "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white placeholder:text-zinc-600";
const primary = "w-full rounded-2xl bg-orange-500 py-4 font-black text-black transition hover:bg-orange-400 disabled:opacity-50";

export default function ServicesLoginPage() {
  const [tab, setTab] = useState<"entrar" | "crear">("entrar");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [catalog, setCatalog] = useState<CatalogEntry[]>(() => mergeCatalog([]));
  const [picked, setPicked] = useState<ServiceId[]>([]);
  const [step, setStep] = useState<"servicios" | "datos">("servicios");

  // Desde la página de venta: ?crear=servicio abre "Crear cuenta" con ese servicio ya elegido
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("crear");
    if (!wanted) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lee la dirección una vez al abrir
    setTab("crear");
    const info = SERVICES.find((s) => s.id === wanted);
    if (info) setPicked(info.addonOf ? [info.addonOf, info.id] : [info.id]);
  }, []);

  useEffect(() => {
    if (!isCloudConfigured) return;
    // Con sesión abierta en este navegador: directo al panel
    void getSupabase()
      .auth.getSession()
      .then(({ data }) => {
        if (data.session) window.location.replace("/servicios");
      });
    // Precios públicos del catálogo
    void getSupabase()
      .from("bpos_service_catalog")
      .select("service, price, trial_days, ai_budget_usd, active")
      .then(({ data }) => data && setCatalog(mergeCatalog(data as Partial<CatalogEntry>[])));
  }, []);

  async function enter() {
    setMessage("");
    if (!email.includes("@") || !password) return setMessage("Escribe tu correo y tu contraseña.");
    setBusy(true);
    try {
      await signIn(email, password);
      window.location.href = "/servicios";
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo entrar.");
      setBusy(false);
    }
  }

  const entry = (id: ServiceId) => catalog.find((c) => c.service === id)!;
  const available = SERVICES.filter((s) => entry(s.id).active);
  const toggle = (id: ServiceId) => {
    const info = SERVICES.find((s) => s.id === id)!;
    setPicked((list) => {
      if (list.includes(id)) return list.filter((x) => x !== id && SERVICES.find((s) => s.id === x)?.addonOf !== id);
      return [...list, id, ...(info.addonOf && !list.includes(info.addonOf) ? [info.addonOf] : [])];
    });
  };
  const total = picked.reduce((s, id) => s + entry(id).price, 0);

  return (
    <main className="min-h-screen bg-black px-4 py-10 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- logo fijo */}
          <img src="/bpos-logo.png" alt="B-POS" className="h-14 w-14 object-contain" />
          <div>
            <p className="text-3xl font-black">B-POS Servicios</p>
            <p className="text-sm text-zinc-400">
              Contrata solo lo que tu restaurante necesita.{" "}
              <Link href="/servicios" className="font-bold text-orange-400 underline">
                Ver servicios
              </Link>
            </p>
          </div>
        </div>

        <div className="mx-auto mt-8 flex max-w-md overflow-hidden rounded-2xl border border-zinc-800">
          {(["entrar", "crear"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`flex-1 py-3 text-sm font-black ${tab === t ? "bg-orange-500 text-black" : "bg-zinc-950 text-zinc-400"}`}>
              {t === "entrar" ? "Entrar" : "Crear cuenta"}
            </button>
          ))}
        </div>

        {tab === "entrar" && (
          <section className="mx-auto mt-6 max-w-md space-y-3 rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@negocio.com" type="email" autoComplete="email" className={input} />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void enter()}
              placeholder="Contraseña"
              type="password"
              autoComplete="current-password"
              className={input}
            />
            {message && <p className="text-center text-sm text-orange-300">{message}</p>}
            <button onClick={() => void enter()} disabled={busy} className={primary}>
              {busy ? "Entrando..." : "Entrar a mi panel"}
            </button>
            <p className="text-center text-xs text-zinc-500">
              ¿Usas B-POS completo? Entra en <Link href="/pos" className="underline hover:text-orange-400">bpos.com.mx/pos</Link>.
            </p>
          </section>
        )}

        {tab === "crear" && step === "servicios" && (
          <section className="mt-6">
            <p className="text-center text-lg font-black">1. ¿Qué servicios quieres probar?</p>
            <p className="text-center text-sm text-zinc-400">Cada uno trae días de prueba gratis, sin tarjeta. Después pagas solo lo que te sirva.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {available.map((s) => {
                const on = picked.includes(s.id);
                const e = entry(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggle(s.id)}
                    className={`rounded-3xl border p-4 text-left transition ${on ? "border-orange-500 bg-orange-500/10" : "border-zinc-800 bg-zinc-950 hover:border-zinc-600"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-lg font-black">
                        {s.emoji} {s.name}
                      </p>
                      <span className={`mt-1 h-5 w-5 shrink-0 rounded-md border-2 ${on ? "border-orange-500 bg-orange-500" : "border-zinc-600"}`} />
                    </div>
                    <p className="mt-1 text-sm text-zinc-400">{s.short}</p>
                    <p className="mt-2 text-sm font-black text-orange-300">
                      {money(e.price)}/mes{s.addonOf ? " (extra)" : ""} · {e.trial_days} días gratis
                    </p>
                  </button>
                );
              })}
            </div>
            <div className="mx-auto mt-5 max-w-md">
              <button onClick={() => (picked.length ? setStep("datos") : setMessage("Elige al menos un servicio."))} className={primary}>
                Siguiente{picked.length ? ` · ${picked.length} servicio${picked.length === 1 ? "" : "s"} (${money(total)}/mes después de la prueba)` : ""}
              </button>
              {message && !picked.length && <p className="mt-2 text-center text-sm text-orange-300">{message}</p>}
            </div>
          </section>
        )}

        {tab === "crear" && step === "datos" && (
          <section className="mx-auto mt-6 max-w-md rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <p className="text-lg font-black">2. Los datos de tu negocio</p>
            <p className="text-sm text-zinc-400">
              Vas a probar: {picked.map((id) => SERVICES.find((s) => s.id === id)!.name).join(", ")}.{" "}
              <button onClick={() => setStep("servicios")} className="text-orange-400 underline">
                Cambiar
              </button>
            </p>
            <SignupForm forServices onCreated={() => servicesCall({ accion: "tipo", servicios: picked }).then(() => undefined)} onDone={() => (window.location.href = "/servicios")} />
          </section>
        )}
      </div>
    </main>
  );
}
