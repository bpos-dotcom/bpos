"use client";
/**
 * Candado del permiso de uso (lib/license.ts): con internet renueva el
 * permiso; si venció (más de 3 días sin conectarse, o el plan se pausó) o el
 * reloj de la computadora se atrasó, tapa B-POS y pide conectarse.
 * Con el plan en pausa y con internet, el aviso lo da PlanLock.
 */
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { licenseStatus, refreshLicense, type LicenseStatus } from "@/lib/license";

const FREE_PATHS = ["/login", "/configuracion/plan", "/acceso-denegado"];
const REFRESH_EVERY_MS = 6 * 60 * 60 * 1000;

export function LicenseLock() {
  const pathname = usePathname() || "/";
  const [status, setStatus] = useState<LicenseStatus>({ ok: true });

  const check = useCallback(async () => {
    let next = await licenseStatus();
    // Venció o falta: si hay internet se renueva antes de bloquear
    if (!next.ok && navigator.onLine && (await refreshLicense())) next = await licenseStatus();
    setStatus(next);
  }, []);

  useEffect(() => {
    let last = 0;
    const renew = async () => {
      if (Date.now() - last < REFRESH_EVERY_MS) return;
      if (await refreshLicense()) last = Date.now();
      await check();
    };
    void renew();
    const tick = setInterval(() => void check(), 60_000);
    const renewTimer = setInterval(() => void renew(), 15 * 60_000);
    const onOnline = () => {
      last = 0;
      void renew();
    };
    window.addEventListener("online", onOnline);
    return () => {
      clearInterval(tick);
      clearInterval(renewTimer);
      window.removeEventListener("online", onOnline);
    };
  }, [check]);

  if (status.ok || FREE_PATHS.some((p) => pathname.startsWith(p))) return null;
  // Plan en pausa con internet: lo explica PlanLock
  if (status.reason === "plan" && navigator.onLine) return null;

  const text =
    status.reason === "reloj"
      ? { title: "La fecha de esta computadora no es correcta", body: "Pon la fecha y hora correctas en Windows y vuelve a abrir B-POS con internet." }
      : status.reason === "plan"
        ? { title: "Tu plan de B-POS está en pausa", body: "Conéctate a internet y activa tu plan en Mi plan para seguir vendiendo. Tus datos están guardados." }
        : { title: "Conéctate a internet para seguir", body: "B-POS puede trabajar sin internet hasta 3 días. Conecta esta computadora para renovar el permiso; tus ventas se suben solas." };

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/90 p-6 text-white backdrop-blur">
      <section className="w-full max-w-lg rounded-3xl border border-orange-500/40 bg-zinc-950 p-8 text-center">
        <p className="text-5xl">{status.reason === "reloj" ? "🕒" : "📡"}</p>
        <h2 className="mt-4 text-3xl font-black">{text.title}</h2>
        <p className="mt-3 text-zinc-300">{text.body}</p>
        <button onClick={() => void check()} className="mt-6 w-full rounded-2xl bg-orange-500 py-4 font-black text-black hover:bg-orange-400">
          Volver a intentar
        </button>
      </section>
    </div>
  );
}
