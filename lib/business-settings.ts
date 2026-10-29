"use client";

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
  bagTicketEnabled: boolean;
};

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
  bagTicketEnabled: true,
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
    bagTicketEnabled: parsed.bagTicketEnabled !== false,
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
