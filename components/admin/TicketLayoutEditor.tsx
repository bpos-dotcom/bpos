"use client";

import { useState } from "react";
import type { BusinessSettings } from "@/lib/business-settings";
import type { DeliveryTicket } from "@/lib/bridge/delivery-ticket";
import { bagTicketHtml, type PaperWidth } from "@/lib/bridge/ticket-html";
import { TICKET_LAYOUT_KINDS, normalizeTicketLayouts, type TicketField, type TicketLayout, type TicketLayoutKind, type TicketTop } from "@/lib/ticket-layout";

/** Pedido de ejemplo de cada tipo, para ver el ticket mientras se configura */
function sample(kind: TicketLayoutKind): DeliveryTicket {
  const base = {
    receivedAt: new Date().toISOString(),
    items: [{ index: 0, qty: 1, name: "Hamburguesa Hawaiana", price: 129.99, choices: [], notes: ["Sin cebolla"], stations: ["Parrilla" as const], pending: false }],
    charges: [],
    total: 129.99,
  };
  if (kind === "uber") return { ...base, kind: "delivery", platform: "Uber Eats", orderId: "7FD5A", localNumber: "000041", customer: "Daniel A." };
  if (kind === "rappi") return { ...base, kind: "delivery", platform: "Rappi", orderId: "152", localNumber: "000042", customer: "Mariana" };
  if (kind === "local") return { ...base, kind: "mostrador", platform: "Mostrador", orderId: "57", customer: "Francisco", payment: "Efectivo" };
  return { ...base, kind: "delivery", platform: "DiDi Food", orderId: "4", localNumber: "000040", customer: "Yulia Cristina" };
}

const TOP_OPTIONS: [TicketTop, string][] = [
  ["logo", "Mi logo"],
  ["name", "Nombre del negocio"],
  ["text", "Texto personalizado"],
  ["none", "Nada"],
];

function fieldOptions(kind: TicketLayoutKind): [TicketField, string][] {
  return [
    ["number", kind === "local" ? "Número del pedido (folio)" : "Número del pedido de la plataforma"],
    ["customer", "Nombre del cliente"],
    ["none", "Nada"],
  ];
}

/** Configurador de tickets: por DiDi, Uber, Rappi y Local, qué va arriba, en el recuadro y en el renglón */
export function TicketLayoutEditor({ settings, onChange, paper }: { settings: BusinessSettings; onChange: (patch: Partial<BusinessSettings>) => void; paper: PaperWidth }) {
  const [kind, setKind] = useState<TicketLayoutKind>("didi");
  const layouts = normalizeTicketLayouts(settings.ticketLayouts);
  const layout = layouts[kind];
  const label = TICKET_LAYOUT_KINDS.find((k) => k.kind === kind)!.label;
  const set = (patch: Partial<TicketLayout>) => onChange({ ticketLayouts: { ...layouts, [kind]: { ...layout, ...patch } } });
  const html = bagTicketHtml(sample(kind), { ...settings, ticketLayouts: layouts }, "", paper);
  const width = paper === 58 ? 384 : 576;
  const scale = 288 / width;
  const select = "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-4 text-white";
  const title = "mb-2 block text-sm font-bold text-zinc-400";
  const besideLabel = kind === "local" ? "Renglón debajo de dónde vino (Mostrador, Mesa…)" : "Renglón junto a \"Delivery\"";

  return (
    <div>
      <h2 className="mt-10 text-2xl font-black text-orange-500">Configurador de tickets</h2>
      <p className="mt-2 text-zinc-400">
        Elige qué sale arriba de cada ticket según de dónde viene el pedido. Aplica a las comandas de cocina y al ticket de la bolsa.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {TICKET_LAYOUT_KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            onClick={() => setKind(k.kind)}
            className={`rounded-2xl px-4 py-3 text-sm font-black ${kind === k.kind ? "bg-orange-500 text-black" : "border border-zinc-800 text-zinc-300"}`}
          >
            {k.label}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_auto]">
        <div className="grid content-start gap-5">
          <label>
            <span className={title}>Arriba del ticket</span>
            <select value={layout.top} onChange={(e) => set({ top: e.target.value as TicketTop })} className={select}>
              {TOP_OPTIONS.map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
            {layout.top === "logo" && !settings.ticketLogo && <span className="mt-1 block text-xs text-zinc-500">Aún no subes logo: sale el nombre del negocio. Súbelo arriba, en Tickets de delivery.</span>}
          </label>
          {layout.top === "text" && (
            <label>
              <span className={title}>Texto personalizado</span>
              <input value={layout.topText} maxLength={80} onChange={(e) => set({ topText: e.target.value })} className={select} placeholder="Ej. Burger Planet Sucursal Centro" />
              <span className="mt-1 block text-xs text-zinc-500">Este texto aparecerá siempre en los tickets de {label}.</span>
            </label>
          )}
          <label>
            <span className={title}>Recuadro grande</span>
            <select value={layout.box} onChange={(e) => set({ box: e.target.value as TicketField })} className={select}>
              {fieldOptions(kind).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-zinc-500">Lo que dice el repartidor al llegar. Si el pedido no trae nombre, va el número.</span>
          </label>
          <label>
            <span className={title}>{besideLabel}</span>
            <select value={layout.beside} onChange={(e) => set({ beside: e.target.value as TicketField })} className={select}>
              {fieldOptions(kind).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-zinc-500">Los cambios se aplican al tocar &quot;Guardar configuración&quot;.</p>
        </div>

        <div>
          <p className="mb-2 text-xs font-black uppercase text-zinc-500">
            Ticket de {label} · papel {paper} mm
          </p>
          <div className="overflow-hidden rounded-xl bg-white" style={{ width: 288, height: 420 }}>
            <iframe title={`Ticket de ${label}`} srcDoc={html} style={{ width, height: 420 / scale, border: 0, transform: `scale(${scale})`, transformOrigin: "0 0" }} />
          </div>
        </div>
      </div>
    </div>
  );
}
