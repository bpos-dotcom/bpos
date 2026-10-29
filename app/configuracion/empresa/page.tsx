"use client";

import { useEffect, useMemo, useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import {
  DEFAULT_TICKET_NOTICE,
  formatWhatsappForDisplay,
  getBusinessSettings,
  saveBusinessSettings,
  type BusinessSettings,
  type TicketSize,
} from "@/lib/business-settings";
import type { DeliveryTicket } from "@/lib/bridge/delivery-ticket";
import { paperWidth, qrSvg } from "@/lib/bridge/order-tickets";
import { bagTicketHtml, stationTicketHtml, type PaperWidth } from "@/lib/bridge/ticket-html";

/** Pedido de ejemplo para la vista previa de los tickets. */
const SAMPLE: DeliveryTicket = {
  platform: "DiDi Food",
  orderId: "1",
  customer: "Francisco",
  receivedAt: new Date().toISOString(),
  items: [
    { index: 0, qty: 1, name: "Combo Especial", price: 189, choices: [{ qty: 1, name: "Kansas city", price: 0, question: "Elige tu hamburguesa especial" }], notes: [], stations: ["Parrilla", "Freidora"], pending: false },
    { index: 1, qty: 1, name: "Hamburguesa Hawaiana", price: 129.99, choices: [], notes: ["Sin cebolla"], stations: ["Parrilla"], pending: false },
  ],
  charges: [
    { label: "Subtotal", amount: 318.99 },
    { label: "Dto. de producto", amount: -70.2 },
    { label: "Tarifa de entrega", amount: 13 },
  ],
  total: 261.79,
};

/**
 * Logo para térmica: las impresoras de tickets solo imprimen negro, así que
 * se reduce a 576 px de ancho y se pasa a blanco y negro puro (lo
 * transparente queda blanco).
 */
async function toThermalLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("No se pudo abrir la imagen."));
      i.src = url;
    });
    const scale = Math.min(1, 576 / img.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("El navegador no pudo procesar la imagen.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < data.data.length; i += 4) {
      const lum = 0.299 * data.data[i] + 0.587 * data.data[i + 1] + 0.114 * data.data[i + 2];
      const v = lum < 200 ? 0 : 255; // colores (como el naranja) → negro
      data.data[i] = data.data[i + 1] = data.data[i + 2] = v;
      data.data[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Vista previa al ancho real de impresión (384 px en 58 mm, 576 px en 80 mm), mostrada a 288 px. */
function Preview({ html, label, paper }: { html: string; label: string; paper: PaperWidth }) {
  const width = paper === 58 ? 384 : 576;
  const scale = 288 / width;
  return (
    <div>
      <p className="mb-2 text-xs font-black uppercase text-zinc-500">{label}</p>
      <div className="overflow-hidden rounded-xl bg-white" style={{ width: 288, height: 560 }}>
        <iframe
          title={label}
          srcDoc={html}
          style={{ width, height: 560 / scale, border: 0, transform: `scale(${scale})`, transformOrigin: "0 0" }}
        />
      </div>
    </div>
  );
}

const SIZE_OPTIONS: [TicketSize, string][] = [
  ["normal", "Normal"],
  ["grande", "Grande"],
  ["extra", "Extra grande"],
];

export default function EmpresaConfigPage() {
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [qr, setQr] = useState("");
  const [paper] = useState<PaperWidth>(() => (typeof window === "undefined" ? 80 : paperWidth()));

  useEffect(() => {
    setSettings(getBusinessSettings());
  }, []);

  useEffect(() => {
    if (!settings) return;
    qrSvg(settings.ticketQrText).then(setQr).catch(() => setQr(""));
  }, [settings]);

  const previews = useMemo(() => {
    if (!settings) return null;
    return {
      parrilla: stationTicketHtml(SAMPLE, "Parrilla", settings, paper),
      bolsa: bagTicketHtml(SAMPLE, settings, qr, paper),
    };
  }, [settings, qr, paper]);

  if (!settings) return null;
  const set = (patch: Partial<BusinessSettings>) => setSettings({ ...settings, ...patch });

  async function onLogo(file: File | undefined) {
    if (!file) return;
    try {
      set({ ticketLogo: await toThermalLogo(file) });
    } catch (error) {
      alert(error instanceof Error ? error.message : "No se pudo cargar el logo.");
    }
  }

  function save() {
    if (!settings) return;
    const phone = settings.ownerWhatsapp.replace(/\D/g, "");
    if (phone.length !== 10 && phone.length !== 12 && phone.length !== 13) {
      alert("Captura un número de WhatsApp válido, con lada. Ejemplo: 5631820373.");
      return;
    }

    setSettings(saveBusinessSettings(settings));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  }

  const input = "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-4 text-white";
  const label = "mb-2 block text-sm font-bold text-zinc-400";

  return (
    <RequireRole allow={["Admin"]}>
      <AppShell
        title="Empresa y propietario"
        subtitle="Datos reutilizados por cortes, listas de compras, tickets y comunicaciones operativas."
      >
        <section className="mx-auto max-w-5xl rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
          <h2 className="text-2xl font-black text-orange-500">Datos del negocio</h2>
          <p className="mt-2 text-zinc-400">
            El WhatsApp del dueño se utilizará para enviar el corte de caja y la lista de compras.
          </p>

          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <label>
              <span className={label}>Nombre del negocio</span>
              <input value={settings.businessName} onChange={(e) => set({ businessName: e.target.value })} className={input} placeholder="Nombre comercial" />
            </label>

            <label>
              <span className={label}>WhatsApp del dueño</span>
              <input
                value={settings.ownerWhatsapp}
                onChange={(e) => set({ ownerWhatsapp: e.target.value })}
                className={input}
                placeholder="Ej. 5631820373"
                inputMode="tel"
              />
              <span className="mt-2 block text-xs text-zinc-500">Guardado como: {formatWhatsappForDisplay(settings.ownerWhatsapp)}</span>
            </label>
          </div>

          <h2 className="mt-10 text-2xl font-black text-orange-500">Tickets de delivery</h2>
          <p className="mt-2 text-zinc-400">
            Los pedidos de DiDi Food, Uber Eats y Rappi salen con estos datos: un ticket por estación (solo lo que le toca) y el ticket
            de la bolsa en Caja, con precios y total.
          </p>

          <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_auto]">
            <div className="grid gap-5">
              <div>
                <span className={label}>Logo (se convierte a blanco y negro para la impresora térmica)</span>
                <div className="flex flex-wrap items-center gap-3">
                  {settings.ticketLogo && (
                    // eslint-disable-next-line @next/next/no-img-element -- vista previa de un data URL local
                    <img src={settings.ticketLogo} alt="Logo del ticket" className="h-16 rounded-lg bg-white p-1" />
                  )}
                  <label className="cursor-pointer rounded-2xl border border-zinc-700 px-4 py-3 text-sm font-black">
                    {settings.ticketLogo ? "Cambiar logo" : "Subir logo"}
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void onLogo(e.target.files?.[0])} />
                  </label>
                  {settings.ticketLogo && (
                    <button onClick={() => set({ ticketLogo: "" })} className="rounded-2xl border border-zinc-800 px-4 py-3 text-sm text-zinc-400">
                      Quitar
                    </button>
                  )}
                </div>
              </div>

              <label>
                <span className={label}>Teléfono para pedidos directos</span>
                <input value={settings.ticketPhone} onChange={(e) => set({ ticketPhone: e.target.value })} className={input} placeholder="Ej. 871 123 4567" />
              </label>

              <label>
                <span className={label}>Aclaración del ticket de bolsa</span>
                <textarea
                  value={settings.ticketNotice}
                  onChange={(e) => set({ ticketNotice: e.target.value })}
                  rows={4}
                  className={input}
                />
                <span className="mt-2 block text-xs text-zinc-500">
                  Se reemplazan solos: <b>{"{plataforma}"}</b> (DiDi Food, Uber Eats o Rappi), <b>{"{negocio}"}</b> y <b>{"{telefono}"}</b>.{" "}
                  <button type="button" onClick={() => set({ ticketNotice: DEFAULT_TICKET_NOTICE })} className="underline">
                    Restaurar texto sugerido
                  </button>
                </span>
              </label>

              <label>
                <span className={label}>Código QR (dirección web o texto; vacío = sin QR)</span>
                <input value={settings.ticketQrText} onChange={(e) => set({ ticketQrText: e.target.value })} className={input} placeholder="Ej. https://wa.me/528711234567" />
              </label>

              <label>
                <span className={label}>Mensaje final</span>
                <input value={settings.ticketFooter} onChange={(e) => set({ ticketFooter: e.target.value })} className={input} />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label>
                  <span className={label}>Tamaño de letra</span>
                  <select value={settings.ticketFontSize} onChange={(e) => set({ ticketFontSize: e.target.value as TicketSize })} className={input}>
                    {SIZE_OPTIONS.map(([value, text]) => (
                      <option key={value} value={value}>{text}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className={label}>Tamaño del logo</span>
                  <select value={settings.ticketLogoSize} onChange={(e) => set({ ticketLogoSize: e.target.value as TicketSize })} className={input}>
                    {SIZE_OPTIONS.map(([value, text]) => (
                      <option key={value} value={value}>{text}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="flex items-center gap-3 text-sm font-bold text-zinc-300">
                <input type="checkbox" checked={settings.ticketShowCustomer} onChange={(e) => set({ ticketShowCustomer: e.target.checked })} />
                Mostrar nombre del cliente
              </label>

              <label className="flex items-center gap-3 text-sm font-bold text-zinc-300">
                <input type="checkbox" checked={settings.ticketShowChoices} onChange={(e) => set({ ticketShowChoices: e.target.checked })} />
                Mostrar opciones y notas de cada producto (ej. &quot;Sin cebolla&quot;)
              </label>

              <label className="flex items-center gap-3 text-sm font-bold text-zinc-300">
                <input type="checkbox" checked={settings.bagTicketEnabled} onChange={(e) => set({ bagTicketEnabled: e.target.checked })} />
                Imprimir ticket de bolsa en Caja
              </label>
            </div>

            {previews && (
              <div className="flex flex-wrap gap-4">
                <Preview label={`Estación · papel ${paper} mm`} html={previews.parrilla} paper={paper} />
                <Preview label={`Bolsa (Caja) · papel ${paper} mm`} html={previews.bolsa} paper={paper} />
              </div>
            )}
          </div>

          <button onClick={save} className="mt-8 rounded-2xl bg-orange-500 px-6 py-4 font-black text-black">
            Guardar configuración
          </button>

          {saved && <p className="mt-4 font-bold text-emerald-400">Configuración guardada correctamente.</p>}
        </section>
      </AppShell>
    </RequireRole>
  );
}
