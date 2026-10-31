/**
 * Club de clientes (fidelidad): la configuración de cada restaurante
 * (Configuración → Club). Se guarda en "bpos_loyalty" (todas las
 * sucursales) y la leen la caja, el servidor y la página
 * bpos.com.mx/fidelidad/<liga>. Las sumas y canjes van en la nube
 * (migración 0016).
 */

export type LoyaltyKind = "puntos" | "sellos" | "cashback";
export type LoyaltyReward = { id: string; name: string; points: number };
export type SocialKey = "whatsapp" | "telegram" | "facebook" | "instagram" | "tiktok" | "web";
export type SocialLink = { on: boolean; url: string };

export type LoyaltyConfig = {
  enabled: boolean;
  /** "Club BP" */
  name: string;
  kind: LoyaltyKind;
  /** Puntos: 1 punto por cada X pesos */
  pesosPerPoint: number;
  /** Puntos: premios para canjear */
  rewards: LoyaltyReward[];
  /** Sellos: cuántos para el premio, qué premio y compra mínima para ganar sello */
  stampsGoal: number;
  stampReward: string;
  stampMinPurchase: number;
  /** Cashback: % de cada compra que regresa como saldo */
  cashbackPercent: number;
  /** Regalo al unirse, en la unidad del club (puntos, sellos o pesos de saldo) */
  welcomeAmount: number;
  /** Texto extra del regalo de bienvenida ("Papas gratis en tu siguiente visita") */
  welcomeText: string;
  /** Botones en la página de fidelidad (solo salen los activados) */
  links: Record<SocialKey, SocialLink>;
  terms: string;
};

export const SOCIALS: { key: SocialKey; label: string; icon: string; color: string; hint: string }[] = [
  { key: "whatsapp", label: "Comunidad de WhatsApp", icon: "💬", color: "#25d366", hint: "https://chat.whatsapp.com/..." },
  { key: "telegram", label: "Comunidad de Telegram", icon: "✈️", color: "#229ed9", hint: "https://t.me/..." },
  { key: "facebook", label: "Facebook", icon: "📘", color: "#1877f2", hint: "https://facebook.com/..." },
  { key: "instagram", label: "Instagram", icon: "📸", color: "#e1306c", hint: "https://instagram.com/..." },
  { key: "tiktok", label: "TikTok", icon: "🎵", color: "#111111", hint: "https://tiktok.com/@..." },
  { key: "web", label: "Página web", icon: "🌐", color: "#52525b", hint: "https://..." },
];

const emptyLinks = () => Object.fromEntries(SOCIALS.map((s) => [s.key, { on: false, url: "" }])) as Record<SocialKey, SocialLink>;

export const DEFAULT_LOYALTY: LoyaltyConfig = {
  enabled: false,
  name: "",
  kind: "puntos",
  pesosPerPoint: 10,
  rewards: [],
  stampsGoal: 6,
  stampReward: "",
  stampMinPurchase: 0,
  cashbackPercent: 5,
  welcomeAmount: 0,
  welcomeText: "",
  links: emptyLinks(),
  terms: "",
};

const num = (v: unknown, fallback: number, min = 0, max = 1_000_000) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const httpsUrl = (v: unknown) => (typeof v === "string" && /^https:\/\/\S+$/i.test(v.trim()) ? v.trim().slice(0, 300) : "");

export function normalizeLoyalty(raw: unknown): LoyaltyConfig {
  const r = (raw || {}) as Partial<LoyaltyConfig>;
  const d = DEFAULT_LOYALTY;
  const links = emptyLinks();
  for (const s of SOCIALS) {
    const l = (r.links as Partial<Record<SocialKey, Partial<SocialLink>>> | undefined)?.[s.key];
    links[s.key] = { on: l?.on === true, url: httpsUrl(l?.url) };
  }
  return {
    enabled: r.enabled === true,
    name: str(r.name, 40),
    kind: r.kind === "sellos" || r.kind === "cashback" ? r.kind : "puntos",
    pesosPerPoint: num(r.pesosPerPoint, d.pesosPerPoint, 1, 10_000),
    rewards: Array.isArray(r.rewards)
      ? r.rewards
          .map((x) => ({ id: str(x?.id, 30) || Math.random().toString(36).slice(2, 8), name: str(x?.name, 60), points: Math.round(num(x?.points, 0, 1)) }))
          .filter((x) => x.name && x.points > 0)
          .slice(0, 20)
      : [],
    stampsGoal: Math.round(num(r.stampsGoal, d.stampsGoal, 2, 30)),
    stampReward: str(r.stampReward, 80),
    stampMinPurchase: num(r.stampMinPurchase, 0),
    cashbackPercent: num(r.cashbackPercent, d.cashbackPercent, 0.5, 50),
    welcomeAmount: num(r.welcomeAmount, 0, 0, 100_000),
    welcomeText: str(r.welcomeText, 100),
    links,
    terms: str(r.terms, 500),
  };
}

/** Nombre que se muestra ("Club Burger Planet" si no le pusieron nombre) */
export const clubName = (c: LoyaltyConfig, business: string) => c.name.trim() || `Club ${business}`;

const money = (n: number) => `$${Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Cómo funciona, en una línea */
export function howItWorks(c: LoyaltyConfig) {
  if (c.kind === "sellos") return `Gana 1 sello en cada compra${c.stampMinPurchase > 0 ? ` desde ${money(c.stampMinPurchase)}` : ""}. Con ${c.stampsGoal} sellos: ${c.stampReward || "tu premio"}.`;
  if (c.kind === "cashback") return `Te regresamos el ${c.cashbackPercent}% de cada compra como saldo para tus siguientes pedidos.`;
  return `Gana 1 punto por cada ${money(c.pesosPerPoint)} y cámbialos por premios.`;
}

/** El regalo de bienvenida ("" si no hay) */
export function welcomeLabel(c: LoyaltyConfig) {
  const amount =
    c.welcomeAmount > 0
      ? c.kind === "sellos"
        ? `${c.welcomeAmount} sello${c.welcomeAmount === 1 ? "" : "s"} de regalo`
        : c.kind === "cashback"
          ? `${money(c.welcomeAmount)} de saldo de regalo`
          : `${c.welcomeAmount} puntos de regalo`
      : "";
  return [amount, c.welcomeText.trim()].filter(Boolean).join(" + ");
}

/** El saldo del socio en palabras ("120 puntos" · "4 de 6 sellos" · "$85.50 de saldo") */
export function balanceLabel(c: LoyaltyConfig, m: { points: number; stamps: number; cashback: number }) {
  if (c.kind === "sellos") return `${m.stamps} de ${c.stampsGoal} sellos`;
  if (c.kind === "cashback") return `${money(m.cashback)} de saldo`;
  return `${Math.floor(m.points)} puntos`;
}

// ------------------------------------------------------------ en B-POS

const KEY = "bpos_loyalty";
export const LOYALTY_EVENT = "bpos:loyalty-updated";

export function getLoyalty(): LoyaltyConfig {
  if (typeof window === "undefined") return DEFAULT_LOYALTY;
  try {
    return normalizeLoyalty(JSON.parse(localStorage.getItem(KEY) || "null"));
  } catch {
    return DEFAULT_LOYALTY;
  }
}

export function saveLoyalty(patch: Partial<LoyaltyConfig>) {
  const next = normalizeLoyalty({ ...getLoyalty(), ...patch });
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(LOYALTY_EVENT));
  return next;
}
