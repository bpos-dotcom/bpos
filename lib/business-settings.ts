"use client";

const BUSINESS_SETTINGS_KEY = "bpos_business_settings";

export type BusinessSettings = {
  businessName: string;
  ownerWhatsapp: string;
};

const DEFAULT_SETTINGS: BusinessSettings = {
  businessName: "Burger Planet",
  ownerWhatsapp: "",
};

function normalizePhone(value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `52${digits}`;
  return digits;
}

export function getBusinessSettings(): BusinessSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;

  try {
    const raw = localStorage.getItem(BUSINESS_SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<BusinessSettings>;
    return {
      businessName: String(parsed.businessName || DEFAULT_SETTINGS.businessName),
      ownerWhatsapp: normalizePhone(String(parsed.ownerWhatsapp || "")),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveBusinessSettings(settings: BusinessSettings) {
  const normalized: BusinessSettings = {
    businessName: String(settings.businessName || DEFAULT_SETTINGS.businessName).trim(),
    ownerWhatsapp: normalizePhone(settings.ownerWhatsapp),
  };

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
