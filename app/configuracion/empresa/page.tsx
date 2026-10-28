"use client";

import { useEffect, useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import {
  formatWhatsappForDisplay,
  getBusinessSettings,
  saveBusinessSettings,
} from "@/lib/business-settings";

export default function EmpresaConfigPage() {
  const [businessName, setBusinessName] = useState("");
  const [ownerWhatsapp, setOwnerWhatsapp] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const settings = getBusinessSettings();
    setBusinessName(settings.businessName);
    setOwnerWhatsapp(settings.ownerWhatsapp);
  }, []);

  function save() {
    const phone = ownerWhatsapp.replace(/\D/g, "");
    if (phone.length !== 10 && phone.length !== 12 && phone.length !== 13) {
      alert("Captura un número de WhatsApp válido, con lada. Ejemplo: 5631820373.");
      return;
    }

    const next = saveBusinessSettings({ businessName, ownerWhatsapp });
    setOwnerWhatsapp(next.ownerWhatsapp);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  }

  return (
    <RequireRole allow={["Admin"]}>
      <AppShell
        title="Empresa y propietario"
        subtitle="Datos reutilizados por cortes, listas de compras y comunicaciones operativas."
      >
        <section className="mx-auto max-w-3xl rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
          <h2 className="text-2xl font-black text-orange-500">Datos del negocio</h2>
          <p className="mt-2 text-zinc-400">
            El WhatsApp del dueño se utilizará para enviar el corte de caja y la lista de compras.
          </p>

          <div className="mt-6 grid gap-5">
            <label>
              <span className="mb-2 block text-sm font-bold text-zinc-400">Nombre del negocio</span>
              <input
                value={businessName}
                onChange={(event) => setBusinessName(event.target.value)}
                className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-4 text-white"
                placeholder="Nombre comercial"
              />
            </label>

            <label>
              <span className="mb-2 block text-sm font-bold text-zinc-400">WhatsApp del dueño</span>
              <input
                value={ownerWhatsapp}
                onChange={(event) => setOwnerWhatsapp(event.target.value)}
                className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-4 text-white"
                placeholder="Ej. 5631820373"
                inputMode="tel"
              />
              <span className="mt-2 block text-xs text-zinc-500">
                Guardado como: {formatWhatsappForDisplay(ownerWhatsapp)}
              </span>
            </label>
          </div>

          <button onClick={save} className="mt-6 rounded-2xl bg-orange-500 px-6 py-4 font-black text-black">
            Guardar configuración
          </button>

          {saved && <p className="mt-4 font-bold text-emerald-400">Configuración guardada correctamente.</p>}
        </section>
      </AppShell>
    </RequireRole>
  );
}
