/**
 * Tarjeta del club en Google Wallet (solo en Vercel).
 *
 *  · walletSaveUrl()      liga "Agregar a Google Wallet" firmada con la cuenta de
 *                         servicio del emisor (crea la clase y la tarjeta del socio).
 *  · syncWalletClass()    manda a Google el diseño de la tarjeta del negocio
 *                         (logo, portada, color, texto, ligas) cuando cambia en
 *                         Configuración → Club.
 *  · syncWalletMember()   actualiza en el celular del socio su saldo y nombre.
 *  · notifyWalletClass()  manda un aviso (notificación) a todas las tarjetas
 *                         del negocio; Google permite 3 al día.
 *
 * Para activarlo (una vez, en la consola de Google Pay & Wallet):
 *   GOOGLE_WALLET_ISSUER_ID         número de emisor
 *   GOOGLE_WALLET_SERVICE_ACCOUNT   JSON de la cuenta de servicio (client_email, private_key)
 * Mientras Google no apruebe al emisor, solo funciona con las cuentas de
 * prueba registradas en la consola.
 */
import { createSign } from "node:crypto";
import { SOCIALS, balanceLabel, clubName, howItWorks, type LoyaltyConfig } from "@/lib/loyalty";

export const walletReady = () => Boolean(process.env.GOOGLE_WALLET_ISSUER_ID && process.env.GOOGLE_WALLET_SERVICE_ACCOUNT);

const API = "https://walletobjects.googleapis.com/walletobjects/v1";
const SITE = "https://www.bpos.com.mx";

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

function account() {
  return JSON.parse(process.env.GOOGLE_WALLET_SERVICE_ACCOUNT!) as { client_email: string; private_key: string };
}

function signJwt(claims: object) {
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(account().private_key);
  return `${unsigned}.${b64url(signature)}`;
}

// ------------------------------------------------------------ qué lleva la tarjeta

/** Lo que necesita la tarjeta del negocio (lo arma el servidor con la configuración del club) */
export type WalletBusiness = {
  businessId: string;
  businessName: string;
  slug: string;
  /** Color de marca; la tarjeta usa el del club si lo cambiaron */
  color: string;
  config: LoyaltyConfig;
};

export type WalletMember = { accountId: string; customerName: string; code: string; points: number; stamps: number; cashback: number };

export const walletClassId = (businessId: string) => `${process.env.GOOGLE_WALLET_ISSUER_ID}.bpos-${businessId.replace(/-/g, "")}`;
export const walletObjectId = (accountId: string) => `${process.env.GOOGLE_WALLET_ISSUER_ID}.m-${accountId.replace(/-/g, "")}`;

export function walletClass(b: WalletBusiness) {
  const c = b.config;
  const links = [{ uri: `${SITE}/m/${b.slug}`, description: "Ver el menú y pedir", id: "menu" }, { uri: `${SITE}/fidelidad/${b.slug}`, description: "Mi club", id: "club" }];
  for (const s of SOCIALS) {
    const l = c.links[s.key];
    if (l?.on && l.url) links.push({ uri: l.url, description: s.label, id: s.key });
  }
  const text = [{ id: "como", header: "Cómo funciona", body: howItWorks(c) }];
  if (c.cardNote.trim()) text.unshift({ id: "nota", header: clubName(c, b.businessName), body: c.cardNote.trim() });
  return {
    id: walletClassId(b.businessId),
    issuerName: b.businessName.slice(0, 40),
    programName: clubName(c, b.businessName).slice(0, 40),
    programLogo: { sourceUri: { uri: `${SITE}/m/${b.slug}/icono?size=192` }, contentDescription: { defaultValue: { language: "es", value: b.businessName } } },
    hexBackgroundColor: c.cardColor || b.color,
    ...(c.cardHero ? { heroImage: { sourceUri: { uri: c.cardHero }, contentDescription: { defaultValue: { language: "es", value: clubName(c, b.businessName) } } } } : {}),
    textModulesData: text,
    linksModuleData: { uris: links },
    reviewStatus: "UNDER_REVIEW",
  };
}

export function walletObject(b: WalletBusiness, m: WalletMember) {
  const c = b.config;
  return {
    id: walletObjectId(m.accountId),
    classId: walletClassId(b.businessId),
    state: "ACTIVE",
    accountId: m.code,
    accountName: m.customerName.slice(0, 40),
    loyaltyPoints: { label: c.kind === "sellos" ? "Sellos" : c.kind === "cashback" ? "Saldo" : "Puntos", balance: { string: balanceLabel(c, m) } },
    barcode: { type: c.cardBarcode, value: m.code, alternateText: m.code },
  };
}

/** Liga "Agregar a Google Wallet" (lleva la clase y la tarjeta; si la clase ya existe, Google usa la que tiene) */
export function walletSaveUrl(b: WalletBusiness, m: WalletMember) {
  const claims = {
    iss: account().client_email,
    aud: "google",
    typ: "savetowallet",
    iat: Math.floor(Date.now() / 1000),
    origins: [SITE],
    payload: { loyaltyClasses: [walletClass(b)], loyaltyObjects: [walletObject(b, m)] },
  };
  return `https://pay.google.com/gp/v/save/${signJwt(claims)}`;
}

// ------------------------------------------------------------ API de Google Wallet

let cached: { token: string; until: number } | null = null;

async function accessToken() {
  if (cached && cached.until > Date.now()) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt({
    iss: account().client_email,
    scope: "https://www.googleapis.com/auth/wallet_object.issuer",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) throw new Error(`Google Wallet no dio acceso: ${data.error_description || res.status}`);
  cached = { token: data.access_token, until: Date.now() + ((data.expires_in || 3600) - 60) * 1000 };
  return data.access_token;
}

export class WalletApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function walletCall<T>(method: "GET" | "POST" | "PUT" | "PATCH", path: string, body?: object): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) throw new WalletApiError(data.error?.message || `Google Wallet respondió ${res.status}`, res.status);
  return data as T;
}

/** Crea o actualiza el diseño de la tarjeta del negocio en Google */
export async function syncWalletClass(b: WalletBusiness) {
  const cls = walletClass(b);
  try {
    await walletCall("GET", `/loyaltyClass/${encodeURIComponent(cls.id)}`);
  } catch (e) {
    if (e instanceof WalletApiError && e.status === 404) {
      await walletCall("POST", "/loyaltyClass", cls);
      return "created" as const;
    }
    throw e;
  }
  await walletCall("PUT", `/loyaltyClass/${encodeURIComponent(cls.id)}`, cls);
  return "updated" as const;
}

/** Actualiza saldo y nombre en la tarjeta del socio; false si aún no la ha agregado */
export async function syncWalletMember(b: WalletBusiness, m: WalletMember) {
  const obj = walletObject(b, m);
  try {
    await walletCall("PATCH", `/loyaltyObject/${encodeURIComponent(obj.id)}`, {
      accountName: obj.accountName,
      loyaltyPoints: obj.loyaltyPoints,
      barcode: obj.barcode,
      state: "ACTIVE",
    });
    return true;
  } catch (e) {
    if (e instanceof WalletApiError && e.status === 404) return false;
    throw e;
  }
}

/** Aviso a todas las tarjetas del negocio (llega como notificación; Google permite 3 al día) */
export async function notifyWalletClass(businessId: string, header: string, body: string) {
  const id = walletClassId(businessId);
  await walletCall("POST", `/loyaltyClass/${encodeURIComponent(id)}/addMessage`, {
    message: { id: `aviso-${Date.now().toString(36)}`, header: header.slice(0, 40), body: body.slice(0, 300), messageType: "TEXT_AND_NOTIFY" },
  });
}
