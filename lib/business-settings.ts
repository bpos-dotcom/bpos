"use client";

import type { KitchenStation } from "@/data/products";

const BUSINESS_SETTINGS_KEY = "bpos_business_settings";

export type BusinessSettings = {
  businessName: string;
  ownerWhatsapp: string;
  /** Tickets personalizados de delivery (estaciones y bolsa) */
  ticketLogo: string; // data URL en blanco y negro, listo para térmica ("" = sin logo)
  ticketPhone: string; // teléfono para pedidos directos
  ticketNotice: string; // aclaración del ticket de bolsa; acepta {plataforma} {negocio} {telefono}
  ticketFooter: string;
  ticketQrText: string; // URL o texto del QR ("" = sin QR)
  ticketQrCaption: string; // texto debajo del QR ("Escanea para pedir directo")
  ticketCutSpace: number; // milímetros en blanco al final de cada ticket para cortarlo a mano (0-60)
  fallbackStation: KitchenStation; // a dónde va lo que no tiene estación (renglón de delivery sin equivalencia)
  bagTicketEnabled: boolean;
  /** Diseño de los tickets (térmica: todo en negro) */
  ticketFontSize: TicketSize; // tamaño de letra
  ticketLogoSize: TicketSize;
  ticketShowCustomer: boolean;
  ticketShowChoices: boolean; // elecciones ("Elige tu...: Kansas city") y notas ("Sin cebolla")
};

export type TicketSize = "normal" | "grande" | "extra";
const SIZES: TicketSize[] = ["normal", "grande", "extra"];

export const DEFAULT_TICKET_NOTICE =
  "Los repartidores de {plataforma} no trabajan directamente para {negocio}. Si tienes algún problema, estamos para ayudarte. Dudas y pedidos directos: {telefono}";

const DEFAULT_SETTINGS: BusinessSettings = {
  businessName: "Burger Planet",
  ownerWhatsapp: "",
  ticketLogo: "",
  ticketPhone: "",
  ticketNotice: DEFAULT_TICKET_NOTICE,
  ticketFooter: "¡Gracias por tu pedido!",
  ticketQrText: "",
  ticketQrCaption: "Escanea para pedir directo",
  ticketCutSpace: 15,
  fallbackStation: "Cocina",
  bagTicketEnabled: true,
  ticketFontSize: "grande",
  ticketLogoSize: "grande",
  ticketShowCustomer: true,
  ticketShowChoices: true,
};

function normalizePhone(value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `52${digits}`;
  return digits;
}

function normalize(parsed: Partial<BusinessSettings>): BusinessSettings {
  const text = (value: unknown, fallback: string) => (typeof value === "string" ? value : fallback);
  return {
    businessName: String(parsed.businessName || DEFAULT_SETTINGS.businessName).trim(),
    ownerWhatsapp: normalizePhone(String(parsed.ownerWhatsapp || "")),
    ticketLogo: text(parsed.ticketLogo, "").startsWith("data:image/") ? text(parsed.ticketLogo, "") : "",
    ticketPhone: text(parsed.ticketPhone, "").trim(),
    ticketNotice: text(parsed.ticketNotice, DEFAULT_SETTINGS.ticketNotice).trim(),
    ticketFooter: text(parsed.ticketFooter, DEFAULT_SETTINGS.ticketFooter).trim(),
    ticketQrText: text(parsed.ticketQrText, "").trim(),
    ticketQrCaption: text(parsed.ticketQrCaption, DEFAULT_SETTINGS.ticketQrCaption).trim(),
    fallbackStation: (["Parrilla", "Freidora", "Barra", "Cocina"] as const).includes(parsed.fallbackStation as KitchenStation) ? (parsed.fallbackStation as KitchenStation) : DEFAULT_SETTINGS.fallbackStation,
    ticketCutSpace: Number.isFinite(Number(parsed.ticketCutSpace)) ? Math.min(60, Math.max(0, Math.round(Number(parsed.ticketCutSpace)))) : DEFAULT_SETTINGS.ticketCutSpace,
    bagTicketEnabled: parsed.bagTicketEnabled !== false,
    ticketFontSize: SIZES.includes(parsed.ticketFontSize as TicketSize) ? (parsed.ticketFontSize as TicketSize) : DEFAULT_SETTINGS.ticketFontSize,
    ticketLogoSize: SIZES.includes(parsed.ticketLogoSize as TicketSize) ? (parsed.ticketLogoSize as TicketSize) : DEFAULT_SETTINGS.ticketLogoSize,
    ticketShowCustomer: parsed.ticketShowCustomer !== false,
    ticketShowChoices: parsed.ticketShowChoices !== false,
  };
}

export function getBusinessSettings(): BusinessSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;

  try {
    const raw = localStorage.getItem(BUSINESS_SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return normalize(JSON.parse(raw) as Partial<BusinessSettings>);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveBusinessSettings(settings: Partial<BusinessSettings>) {
  const normalized = normalize({ ...getBusinessSettings(), ...settings });

  localStorage.setItem(BUSINESS_SETTINGS_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent("bpos:business-settings-updated", { detail: normalized }));
  return normalized;
}

export function getOwnerWhatsapp() {
  return getBusinessSettings().ownerWhatsapp;
}

export function formatWhatsappForDisplay(value: string) {
  const phone = normalizePhone(value);
  if (phone.startsWith("52") && phone.length === 12) {
    return `+52 ${phone.slice(2, 5)} ${phone.slice(5, 8)} ${phone.slice(8)}`;
  }
  return phone ? `+${phone}` : "Sin configurar";
}
