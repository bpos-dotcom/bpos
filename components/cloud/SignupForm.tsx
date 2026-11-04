"use client";
/**
 * Crear cuenta de un negocio nuevo (desde /pos → "Crear cuenta"):
 *   1. nombre del negocio, dirección, teléfono, correo y contraseña
 *   2. código de 6 dígitos que llega al correo (/api/registro)
 *   3. se crea el usuario ya confirmado, entra, da de alta el negocio y
 *      deja el nombre, la dirección y el teléfono en la configuración; el
 *      dueño queda como administrador con su nombre y PIN (lib/cloud/new-business).
 */
import { useState } from "react";
import { createBusiness, signIn } from "@/lib/cloud/account";
import { PIN_RE, startNewBusinessHere } from "@/lib/cloud/new-business";
import { TRIAL_DAYS } from "@/lib/plans";

const input = "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white placeholder:text-zinc-600";
const primary = "w-full rounded-2xl bg-orange-500 py-4 font-black text-black transition hover:bg-orange-400 disabled:opacity-50";
const label = "block text-sm font-bold text-zinc-400";

async function registro(body: object) {
  const r = await fetch("/api/registro", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
  if (!r.ok || !data.success) throw new Error(data.error || "No se pudo. Intenta otra vez.");
  return data;
}

export function SignupForm({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<"datos" | "codigo">("datos");
  const [businessName, setBusinessName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [pin, setPin] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function sendCode() {
    setMessage("");
    if (businessName.trim().length < 2) return setMessage("Escribe el nombre del negocio.");
    if (address.trim().length < 5) return setMessage("Escribe la dirección del negocio (calle, número y colonia).");
    if (phone.replace(/\D/g, "").length < 10) return setMessage("Escribe un teléfono de 10 dígitos.");
    if (!email.includes("@")) return setMessage("Escribe un correo válido.");
    if (password.length < 6) return setMessage("La contraseña debe tener al menos 6 caracteres.");
    if (ownerName.trim().length < 2) return setMessage("Escribe tu nombre (serás el administrador en la caja).");
    if (!PIN_RE.test(pin)) return setMessage("Tu PIN para la caja debe ser de 4 a 8 números.");
    setBusy(true);
    try {
      await registro({ accion: "codigo", email });
      setStep("codigo");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo mandar el código.");
    }
    setBusy(false);
  }

  async function create() {
    setMessage("");
    if (code.replace(/\D/g, "").length !== 6) return setMessage("Escribe los 6 dígitos del código.");
    setBusy(true);
    try {
      await registro({ accion: "crear", email, code, password, businessName, address, phone });
      await signIn(email, password);
      await createBusiness(businessName.trim(), "Matriz");
      // Empieza en limpio: el dueño como administrador (su nombre y PIN) y lo capturado en la configuración
      await startNewBusinessHere({
        ownerName,
        pin,
        settings: { businessName: businessName.trim(), address: address.trim(), businessEmail: email.trim(), ticketPhone: phone, ownerWhatsapp: phone },
      });
      onDone();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo crear la cuenta.");
    }
    setBusy(false);
  }

  if (step === "codigo") {
    return (
      <div className="mt-6 space-y-4">
        <p className="rounded-2xl border border-orange-500/40 bg-orange-500/10 p-3 text-center text-sm text-orange-200">
          Te mandamos un código de 6 dígitos a <b>{email}</b>. Revisa también la carpeta de Spam.
        </p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="Código de 6 dígitos"
          inputMode="numeric"
          autoComplete="one-time-code"
          className={`${input} text-center text-2xl font-black tracking-[0.4em]`}
        />
        {message && <p className="text-center text-sm text-orange-300">{message}</p>}
        <button onClick={create} disabled={busy} className={primary}>
          {busy ? "Creando tu cuenta..." : "Crear mi cuenta"}
        </button>
        <div className="flex justify-between text-sm text-zinc-500">
          <button onClick={() => setStep("datos")} className="hover:text-orange-400">
            ← Corregir datos
          </button>
          <button onClick={sendCode} disabled={busy} className="hover:text-orange-400">
            Mandar otro código
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-3">
      <label className={label}>
        Nombre del negocio
        <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} maxLength={60} placeholder="Ej. Tacos El Güero" className={`${input} mt-1`} />
      </label>
      <label className={label}>
        Dirección del negocio
        <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} placeholder="Calle, número, colonia y ciudad" autoComplete="street-address" className={`${input} mt-1`} />
      </label>
      <label className={label}>
        Teléfono del negocio
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10 dígitos, ej. 871 123 4567" type="tel" inputMode="tel" autoComplete="tel" className={`${input} mt-1`} />
      </label>
      <label className={label}>
        Correo (ahí llega el código)
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@negocio.com" type="email" autoComplete="email" className={`${input} mt-1`} />
      </label>
      <label className={label}>
        Contraseña
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendCode()}
          placeholder="Mínimo 6 caracteres"
          type="password"
          autoComplete="new-password"
          className={`${input} mt-1`}
        />
      </label>
      <label className={label}>
        Tu nombre (administrador en la caja)
        <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} maxLength={40} placeholder="Ej. Tomás" autoComplete="name" className={`${input} mt-1`} />
      </label>
      <label className={label}>
        Tu PIN para entrar a la caja (4 a 8 números)
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/D/g, "").slice(0, 8))}
          inputMode="numeric"
          type="password"
          autoComplete="off"
          placeholder="••••"
          className={`${input} mt-1`}
        />
      </label>
      {message && <p className="text-center text-sm text-orange-300">{message}</p>}
      <button onClick={sendCode} disabled={busy} className={primary}>
        {busy ? "Mandando el código..." : "Mandar código al correo"}
      </button>
      <p className="text-center text-xs text-zinc-500">{TRIAL_DAYS} días gratis, sin tarjeta. Tu negocio queda a tu nombre y con tu dirección desde el primer día.</p>
      <p className="text-center text-xs text-zinc-500">
        Al crear tu cuenta aceptas los{" "}
        <a href="/terminos" target="_blank" className="underline hover:text-orange-400">términos y condiciones</a> y el{" "}
        <a href="/privacidad" target="_blank" className="underline hover:text-orange-400">aviso de privacidad</a>.
      </p>
    </div>
  );
}
