/**
 * Kiosco de autoservicio (corre solo en Vercel, con la llave de servicio).
 *
 * El kiosco es el menú digital de la sucursal en una pantalla táctil del
 * local. Para que una pantalla cualquiera no pueda mandar cobros a la
 * terminal, primero se vincula: en Configuración → Menú digital se genera un
 * código de 6 dígitos y en la pantalla se escriben el correo de una cuenta
 * del negocio y ese código. La pantalla recibe una llave (aquí solo se guarda
 * su huella) que manda en cada llamada.
 *
 * El pedido se guarda como pedido en línea (mismo camino que el menú digital)
 * con pago "Mercado Pago" y el cobro se manda a la terminal Point asignada a
 * la pantalla. El resultado siempre se pregunta a Mercado Pago; cuando el
 * cobro queda procesado, el pedido se marca pagado y el negocio lo ve en
 * Pedidos en línea.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Product } from "@/data/products";
import { supabaseAdmin } from "@/lib/billing/mercadopago";
import { OWN_OPTIONS, buildSelection, extrasPrice, modifierProblem } from "@/lib/compound";
import {
  isAvailableOnline,
  isOpenNow,
  kioskLabel,
  normalizeDigitalMenu,
  onlineGroups,
  type KioskEat,
  type OnlineMpPayment,
  type OnlineOrderData,
  type OnlineOrderLine,
} from "@/lib/digital-menu";
import { kioskTicketHtml, ticketSettings } from "@/lib/kiosk/ticket";
import { clubName, normalizeLoyalty } from "@/lib/loyalty";
import { cancelPointOrder, createPointOrder, getPointOrder, listTerminals, merchantToken, setTerminalPdv, type PointOrder } from "@/lib/mp/merchant";

export class KioskError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export type Kiosk = {
  id: string;
  business_id: string;
  branch_id: string;
  name: string;
  terminal_id: string;
  /** Impresora del ticket del cliente (del Agent de la pantalla) y ancho del papel */
  printer: string;
  paper_mm: number;
  last_seen_at: string | null;
  created_at: string;
  revoked_at: string | null;
};

/** B-POS Agent de la sucursal (la computadora de la caja o la de una pantalla). */
export type KioskAgent = { id: string; name: string; kiosk_id: string | null; printers: { name: string; displayName?: string }[]; online: boolean };

const KIOSK_COLUMNS = "id, business_id, branch_id, name, terminal_id, printer, paper_mm, last_seen_at, created_at, revoked_at";
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export function kioskConfigured() {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// ------------------------------------------------------------ vincular

/** Código de 6 dígitos para vincular una pantalla a la sucursal (15 minutos). */
export async function newKioskCode(businessId: string, branchId: string, userId: string) {
  const db = supabaseAdmin();
  await db.from("bpos_kiosk_codes").delete().lt("expires_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { error } = await db.from("bpos_kiosk_codes").insert({ code, business_id: businessId, branch_id: branchId, created_by: userId, expires_at: expires });
    if (!error) return { code, expiresAt: expires };
    if (error.code !== "23505") throw new KioskError(error.message, 500);
  }
  throw new KioskError("No se pudo generar el código. Intenta de nuevo.", 500);
}

/** Correos de las cuentas del negocio (dueño y miembros), en minúsculas. */
async function businessEmails(db: SupabaseClient, businessId: string) {
  const [{ data: business }, { data: members }] = await Promise.all([
    db.from("businesses").select("owner_id").eq("id", businessId).maybeSingle(),
    db.from("business_members").select("user_id").eq("business_id", businessId).limit(30),
  ]);
  const ids = new Set<string>();
  if (business?.owner_id) ids.add(String(business.owner_id));
  for (const m of members || []) ids.add(String(m.user_id));
  const emails = new Set<string>();
  for (const id of ids) {
    const { data } = await db.auth.admin.getUserById(id);
    const email = data?.user?.email?.trim().toLowerCase();
    if (email) emails.add(email);
  }
  return emails;
}

export type KioskSession = {
  token: string;
  kioskId: string;
  name: string;
  slug: string;
  business: { name: string; logo: string; color: string };
  branch: string;
};

/** La pantalla canjea correo + código por su llave (solo se entrega esta vez). */
export async function pairKiosk(emailRaw: unknown, codeRaw: unknown, nameRaw: unknown): Promise<KioskSession> {
  const email = String(emailRaw || "").trim().toLowerCase();
  const code = String(codeRaw || "").replace(/\D/g, "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new KioskError("Escribe el correo de la cuenta del negocio.");
  if (code.length !== 6) throw new KioskError("El código es de 6 dígitos.");
  const db = supabaseAdmin();
  const { data: row } = await db.from("bpos_kiosk_codes").select("*").eq("code", code).maybeSingle();
  if (!row || row.used_at || Date.parse(row.expires_at) < Date.now()) throw new KioskError("Código inválido o vencido. Genera otro en Configuración → Menú digital.");
  const emails = await businessEmails(db, row.business_id);
  if (!emails.has(email)) throw new KioskError("Ese correo no es de una cuenta de este negocio. Revisa el correo o genera el código desde la cuenta correcta.", 403);

  const { data: link } = await db.from("bpos_menu_links").select("slug").eq("branch_id", row.branch_id).maybeSingle();
  if (!link?.slug) throw new KioskError("Esta sucursal todavía no tiene liga de menú digital. Publícalo primero en Configuración → Menú digital.", 409);

  await db.from("bpos_kiosk_codes").update({ used_at: new Date().toISOString() }).eq("code", code);
  const token = randomBytes(32).toString("hex");
  const { count } = await db.from("bpos_kiosks").select("id", { count: "exact", head: true }).eq("branch_id", row.branch_id).is("revoked_at", null);
  const name = String(nameRaw || "").trim().slice(0, 60) || `Pantalla ${(count || 0) + 1}`;
  const { data: kiosk, error } = await db
    .from("bpos_kiosks")
    .insert({ business_id: row.business_id, branch_id: row.branch_id, name, token_hash: hash(token), last_seen_at: new Date().toISOString() })
    .select(KIOSK_COLUMNS)
    .single();
  if (error || !kiosk) throw new KioskError(error?.message || "No se pudo vincular la pantalla.", 500);
  const info = await kioskInfo(kiosk as Kiosk);
  return { token, kioskId: kiosk.id, name, slug: link.slug, business: info.business, branch: info.branch };
}

/** Nombre, logo y color del negocio, y nombre de la sucursal (para la pantalla de inicio). */
async function kioskInfo(kiosk: Kiosk) {
  const db = supabaseAdmin();
  const [{ data: settings }, { data: business }, { data: branch }] = await Promise.all([
    db.from("sync_records").select("data").eq("business_id", kiosk.business_id).eq("scope", "business").eq("collection", "bpos_business_settings").eq("record_id", "__doc__").maybeSingle(),
    db.from("businesses").select("name").eq("id", kiosk.business_id).maybeSingle(),
    db.from("branches").select("name").eq("id", kiosk.branch_id).maybeSingle(),
  ]);
  const s = (settings?.data || {}) as { businessName?: string; brandColor?: string; brandLogo?: string };
  return {
    business: {
      name: String(s.businessName || business?.name || "B-POS"),
      logo: typeof s.brandLogo === "string" ? s.brandLogo : "",
      color: /^#[0-9a-f]{6}$/i.test(s.brandColor || "") ? s.brandColor! : "#f97316",
    },
    branch: String(branch?.name || ""),
  };
}

/** La pantalla que llama (por su llave en x-kiosk-token). */
export async function kioskFromRequest(request: Request): Promise<Kiosk> {
  const token = String(request.headers.get("x-kiosk-token") || "").trim();
  if (!/^[0-9a-f]{64}$/.test(token)) throw new KioskError("Esta pantalla no está vinculada.", 401);
  const db = supabaseAdmin();
  const { data } = await db.from("bpos_kiosks").select(KIOSK_COLUMNS).eq("token_hash", hash(token)).maybeSingle();
  if (!data || data.revoked_at) throw new KioskError("Esta pantalla fue desvinculada. Vuelve a vincularla.", 401);
  void db.from("bpos_kiosks").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id).then(() => undefined, () => undefined);
  return data as Kiosk;
}

/** Estado para la pantalla: liga del menú, si tiene terminal y datos del negocio. */
export async function kioskStatus(kiosk: Kiosk) {
  const db = supabaseAdmin();
  const [{ data: link }, info, mp, { data: menuDoc }] = await Promise.all([
    db.from("bpos_menu_links").select("slug").eq("branch_id", kiosk.branch_id).maybeSingle(),
    kioskInfo(kiosk),
    merchantToken(kiosk.business_id).catch(() => null),
    db.from("sync_records").select("data").eq("business_id", kiosk.business_id).eq("scope", kiosk.branch_id).eq("collection", "bpos_digital_menu").eq("record_id", "__doc__").maybeSingle(),
  ]);
  const design = (menuDoc?.data as { design?: { theme?: string } } | null)?.design;
  return {
    kioskId: kiosk.id,
    name: kiosk.name,
    slug: String(link?.slug || ""),
    business: info.business,
    branch: info.branch,
    /** Puede cobrar: Mercado Pago vinculado y terminal asignada */
    terminal: Boolean(mp && kiosk.terminal_id),
    /** Colores del menú (Configuración → Menú digital → Diseño): la pantalla de inicio los sigue */
    theme: design?.theme === "dark" ? "dark" : "light",
  };
}

// ------------------------------------------------------------ club de clientes

export type KioskClub = { name: string; kind: "puntos" | "sellos" | "cashback" };
export type KioskClubMember = { accountId: string; name: string; member: boolean };

/** El club del negocio (Configuración → Club), si está encendido: nombre y tipo. */
export async function kioskClub(kiosk: Kiosk): Promise<KioskClub | null> {
  const db = supabaseAdmin();
  const [{ data: row }, info] = await Promise.all([
    db.from("sync_records").select("data").eq("business_id", kiosk.business_id).eq("scope", "business").eq("collection", "bpos_loyalty").eq("record_id", "__doc__").maybeSingle(),
    kioskInfo(kiosk),
  ]);
  const cfg = normalizeLoyalty(row?.data);
  if (!cfg.enabled) return null;
  return { name: clubName(cfg, info.business.name), kind: cfg.kind };
}

/**
 * Busca al cliente por el teléfono con el que se registró en el menú del
 * negocio (su "número del club"). Solo cuentas verificadas de ESTE negocio.
 */
export async function findClubMember(kiosk: Kiosk, phone: unknown): Promise<KioskClubMember | null> {
  const digits = String(phone || "").replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return null;
  const db = supabaseAdmin();
  const { data: account } = await db
    .from("bpos_customer_accounts")
    .select("id, name")
    .eq("business_id", kiosk.business_id)
    .eq("phone", digits)
    .not("email_verified_at", "is", null)
    .maybeSingle();
  if (!account) return null;
  const { data: member } = await db.from("bpos_loyalty_members").select("account_id").eq("account_id", account.id).maybeSingle();
  return { accountId: account.id, name: String(account.name || ""), member: Boolean(member) };
}

// ------------------------------------------------------------ pantallas (negocio)

export async function listKiosks(businessId: string, branchId: string) {
  const { data, error } = await supabaseAdmin()
    .from("bpos_kiosks")
    .select(KIOSK_COLUMNS)
    .eq("business_id", businessId)
    .eq("branch_id", branchId)
    .is("revoked_at", null)
    .order("created_at");
  if (error) throw new KioskError(error.message, 500);
  return (data || []) as Kiosk[];
}

/** Agents exclusivos de las pantallas de la sucursal (vinculados con su propio código). */
export async function listKioskAgents(branchId: string): Promise<KioskAgent[]> {
  const { data } = await supabaseAdmin().from("bpos_agents").select("id, name, kiosk_id, printers, last_seen_at").eq("branch_id", branchId).not("kiosk_id", "is", null).is("revoked_at", null).order("created_at");
  const now = Date.now();
  return (data || []).map((a) => ({
    id: a.id,
    name: String(a.name || ""),
    kiosk_id: a.kiosk_id || null,
    printers: Array.isArray(a.printers) ? (a.printers as KioskAgent["printers"]) : [],
    online: Boolean(a.last_seen_at && now - Date.parse(a.last_seen_at) < 30_000),
  }));
}

const AGENT_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Código de 8 letras para vincular el B-POS Agent de la computadora del
 * kiosco (como el de Configuración → Sistema, pero ligado a la pantalla:
 * ese Agent solo imprime el ticket del kiosco y nunca toma comandas).
 */
export async function newKioskAgentCode(businessId: string, kioskId: string, userId: string) {
  const db = supabaseAdmin();
  const { data: kiosk } = await db.from("bpos_kiosks").select(KIOSK_COLUMNS).eq("id", kioskId).eq("business_id", businessId).is("revoked_at", null).maybeSingle();
  if (!kiosk) throw new KioskError("Pantalla no encontrada.", 404);
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = Array.from({ length: 8 }, () => AGENT_CODE_ALPHABET[randomInt(0, AGENT_CODE_ALPHABET.length)]).join("");
    const { error } = await db.from("bpos_agent_codes").insert({ code, business_id: businessId, branch_id: kiosk.branch_id, created_by: userId, expires_at: expiresAt, kiosk_id: kioskId });
    if (!error) return { code, expiresAt };
    if (!/duplicate|unique/i.test(error.message)) throw new KioskError(error.message, 500);
  }
  throw new KioskError("No se pudo generar el código. Intenta de nuevo.", 500);
}

/** Desvincula el Agent de la pantalla (deja de imprimir; la pantalla sigue funcionando). */
export async function unlinkKioskAgent(businessId: string, kioskId: string) {
  const db = supabaseAdmin();
  const { data: kiosk } = await db.from("bpos_kiosks").select("id").eq("id", kioskId).eq("business_id", businessId).maybeSingle();
  if (!kiosk) throw new KioskError("Pantalla no encontrada.", 404);
  await db.from("bpos_agents").update({ revoked_at: new Date().toISOString() }).eq("kiosk_id", kioskId).is("revoked_at", null);
  await db.from("bpos_kiosks").update({ printer: "" }).eq("id", kioskId);
}

export async function updateKiosk(businessId: string, id: string, patch: { name?: string; terminalId?: string; printer?: string; paperMm?: number }) {
  const db = supabaseAdmin();
  const { data: kiosk } = await db.from("bpos_kiosks").select(KIOSK_COLUMNS).eq("id", id).eq("business_id", businessId).maybeSingle();
  if (!kiosk) throw new KioskError("Pantalla no encontrada.", 404);
  const next: Record<string, string | number> = {};
  if (patch.name !== undefined) next.name = String(patch.name).trim().slice(0, 60) || kiosk.name;
  if (patch.printer !== undefined) next.printer = String(patch.printer).trim().slice(0, 200);
  if (patch.paperMm !== undefined) next.paper_mm = Number(patch.paperMm) === 58 ? 58 : 80;
  if (patch.terminalId !== undefined) {
    const terminalId = String(patch.terminalId).slice(0, 120);
    if (terminalId) {
      const token = await merchantToken(businessId);
      if (!token) throw new KioskError("Primero vincula tu cuenta de Mercado Pago en Configuración → Métodos de pago.", 409);
      const terminal = (await listTerminals(token)).find((t) => t.id === terminalId);
      if (!terminal) throw new KioskError("Esa terminal no está en tu cuenta de Mercado Pago.", 404);
      if (terminal.operating_mode !== "PDV") await setTerminalPdv(token, terminalId);
    }
    next.terminal_id = terminalId;
  }
  const { error } = await db.from("bpos_kiosks").update(next).eq("id", id);
  if (error) throw new KioskError(error.message, 500);
}

export async function revokeKiosk(businessId: string, id: string) {
  const db = supabaseAdmin();
  const { error } = await db.from("bpos_kiosks").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("business_id", businessId);
  if (error) throw new KioskError(error.message, 500);
  // Su Agent (exclusivo del kiosco) también queda desvinculado
  await db.from("bpos_agents").update({ revoked_at: new Date().toISOString() }).eq("kiosk_id", id).is("revoked_at", null);
}

/**
 * Ticket del cliente en la impresora de la pantalla: un trabajo dirigido al
 * Agent de esa pantalla (lo imprime en cuanto lo lea). Sin Agent o sin
 * impresora, no pasa nada: el cliente ve su número en la pantalla.
 */
async function printKioskTicket(db: SupabaseClient, kiosk: Kiosk, order: OrderRow) {
  if (!kiosk.printer) return false;
  const { data: agent } = await db.from("bpos_agents").select("id").eq("kiosk_id", kiosk.id).is("revoked_at", null).maybeSingle();
  if (!agent) return false;
  const [{ data: settingsDoc }, info] = await Promise.all([
    db.from("sync_records").select("data").eq("business_id", kiosk.business_id).eq("scope", "business").eq("collection", "bpos_business_settings").eq("record_id", "__doc__").maybeSingle(),
    kioskInfo(kiosk),
  ]);
  const html = await kioskTicketHtml(order, ticketSettings(settingsDoc?.data, info.business.name), kiosk.paper_mm === 58 ? 58 : 80);
  const { error } = await db.from("bpos_agent_jobs").insert({
    business_id: kiosk.business_id,
    branch_id: kiosk.branch_id,
    kind: "print-tickets",
    payload: { platform: "kiosco", orderId: order.folio, tickets: [{ target: "Caja", html }] },
    target_agent: agent.id,
  });
  return !error;
}

// ------------------------------------------------------------ pedido y cobro

type PublicMenu = { slug: string; menu: unknown; products: Product[] };
type OrderRow = { id: string; business_id: string; branch_id: string; folio: string; token: string; status: string; data: OnlineOrderData; created_at: string };
const ORDER_COLUMNS = "id, business_id, branch_id, folio, token, status, data, created_at";

type IncomingLine = { productId?: unknown; quantity?: unknown; picks?: unknown; comment?: unknown };

/**
 * Arma los renglones con los precios y opciones del menú publicado (no con lo
 * que mandó la pantalla): el total que se cobra es el del negocio.
 */
function priceLines(pub: PublicMenu, incoming: IncomingLine[]): { lines: OnlineOrderLine[]; subtotal: number } {
  const menu = normalizeDigitalMenu(pub.menu as Parameters<typeof normalizeDigitalMenu>[0]);
  const catalog = (pub.products || []).map((p) => ({ ...p, id: Number(p.id), price: Number(p.price) })) as Product[];
  const now = new Date();
  const lines: OnlineOrderLine[] = [];
  for (const raw of incoming) {
    const product = catalog.find((p) => Number(p.id) === Number(raw.productId));
    if (!product || product.notSoldAlone || !isAvailableOnline(menu, product, now)) throw new KioskError("Uno de los productos ya no está disponible. Revisa tu pedido.");
    const { groups, blocked } = onlineGroups(product, catalog, menu, now);
    if (blocked) throw new KioskError(`${product.name} ya no está disponible. Revisa tu pedido.`);
    const picksIn = (raw.picks && typeof raw.picks === "object" ? (raw.picks as Record<string, Record<string, string[]>>)[OWN_OPTIONS] : null) || {};
    const picks: Record<string, string[]> = {};
    for (const g of groups) {
      const chosen = Array.isArray(picksIn[g.key]) ? picksIn[g.key].map(String).filter((k) => g.options.some((o) => o.key === k)) : [];
      if (chosen.length) picks[g.key] = chosen;
    }
    const problem = modifierProblem(groups, picks);
    if (problem) throw new KioskError(`${product.name}: ${problem}.`);
    const withGroups = { ...product, modifierGroups: groups } as Product;
    const selection = buildSelection(withGroups, catalog, { [OWN_OPTIONS]: picks });
    const unitPrice = Math.round((Number(product.price) + extrasPrice(selection.modifiers, selection.parts)) * 100) / 100;
    const quantity = Math.max(1, Math.min(50, Math.round(Number(raw.quantity) || 1)));
    const summary = [
      ...(selection.parts || []).map((p) => `${p.quantity > 1 ? `${p.quantity} ` : ""}${p.name}`),
      ...(selection.modifiers || []).filter((m) => !m.extra).map((m) => m.name),
    ].join(" · ");
    const comment = String(raw.comment || "").trim().slice(0, 140);
    lines.push({ productId: Number(product.id), name: product.name, quantity, unitPrice, picks: { [OWN_OPTIONS]: picks }, summary, ...(comment ? { comment } : {}) });
  }
  const subtotal = Math.round(lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0) * 100) / 100;
  return { lines, subtotal };
}

async function findOrder(db: SupabaseClient, kiosk: Kiosk, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new KioskError("Pedido no encontrado.", 404);
  const { data } = await db.from("bpos_online_orders").select(ORDER_COLUMNS).eq("id", id).eq("branch_id", kiosk.branch_id).maybeSingle();
  const order = data as OrderRow | null;
  if (!order || !order.data.kiosk) throw new KioskError("Pedido no encontrado.", 404);
  return order;
}

async function kioskTerminal(kiosk: Kiosk) {
  if (!kiosk.terminal_id) throw new KioskError("Esta pantalla no tiene terminal asignada. Asígnala en Configuración → Menú digital → Kiosco.", 409);
  const token = await merchantToken(kiosk.business_id);
  if (!token) throw new KioskError("El negocio no tiene Mercado Pago vinculado.", 409);
  return { token, terminalId: kiosk.terminal_id };
}

/** Manda el cobro del pedido a la terminal y lo deja anotado en el pedido. */
async function sendToTerminal(db: SupabaseClient, kiosk: Kiosk, order: OrderRow, attempt: number) {
  const { token, terminalId } = await kioskTerminal(kiosk);
  const total = Math.round(Number(order.data.total) * 100) / 100;
  if (!(total >= 1)) throw new KioskError("El total del pedido no es válido.");
  const reference = `kiosco-${order.id}-${attempt}`;
  const point = await createPointOrder(token, terminalId, total, reference, `Pedido ${order.folio} · kiosco`);
  await db.from("bpos_mp_charges").insert({ id: point.id, business_id: kiosk.business_id, branch_id: kiosk.branch_id, amount: total, reference, status: point.status });
  const data: OnlineOrderData = { ...order.data, kiosk: { ...order.data.kiosk!, chargeId: point.id } };
  await db.from("bpos_online_orders").update({ data, updated_at: new Date().toISOString() }).eq("id", order.id);
  return { ...order, data };
}

export type KioskOrderResult = {
  id: string;
  folio: string;
  total: number;
  status: "esperando";
  /** Nombre del socio del club al que se ligó el pedido (si puso su número) */
  club?: string;
};

/**
 * El cliente tocó "Pagar": se guarda el pedido y la terminal se enciende con el total.
 * Si puso su número del club, el pedido queda ligado a su cuenta y al aceptarlo
 * en B-POS se le suma como cualquier pedido en línea con cuenta.
 */
export async function createKioskOrder(kiosk: Kiosk, body: { lines?: unknown; eat?: unknown; name?: unknown; club?: unknown }): Promise<KioskOrderResult> {
  const db = supabaseAdmin();
  const { data: link } = await db.from("bpos_menu_links").select("slug").eq("branch_id", kiosk.branch_id).maybeSingle();
  if (!link?.slug) throw new KioskError("Esta sucursal no tiene menú digital publicado.", 409);
  await kioskTerminal(kiosk);
  const { data: pub, error } = await db.rpc("bpos_menu_public", { p_slug: link.slug });
  if (error || !pub) throw new KioskError("No se pudo leer el menú.", 502);
  const menuPub = pub as PublicMenu;
  const menu = normalizeDigitalMenu(menuPub.menu as Parameters<typeof normalizeDigitalMenu>[0]);
  if (!menu.enabled || !menu.acceptOrders || !isOpenNow(menu)) throw new KioskError("Por ahora no estamos recibiendo pedidos.", 409);
  const incoming = Array.isArray(body.lines) ? (body.lines as IncomingLine[]) : [];
  if (!incoming.length) throw new KioskError("Tu pedido está vacío.");
  if (incoming.length > 60) throw new KioskError("El pedido es demasiado grande. Divídelo en dos.");
  const { lines, subtotal } = priceLines(menuPub, incoming);
  if (menu.minOrder > 0 && subtotal < menu.minOrder) throw new KioskError(`El pedido mínimo es de $${menu.minOrder.toFixed(2)}.`);
  const eat: KioskEat = body.eat === "aqui" ? "aqui" : "llevar";
  const member = body.club ? await findClubMember(kiosk, body.club) : null;
  const name = String(body.name || "").trim().slice(0, 60) || (member?.name.trim().split(" ")[0] ?? "");
  const order: OnlineOrderData = {
    type: "Recoger",
    customer: { name: name || "Cliente del kiosco", phone: "", address: "", reference: "" },
    payment: "Mercado Pago",
    note: "",
    lines,
    subtotal,
    deliveryFee: 0,
    total: subtotal,
    kiosk: { eat, screen: kiosk.name },
  };
  const { data: placed, error: placeError } = await db.rpc("bpos_menu_place_order", { p_slug: link.slug, p_order: order });
  if (placeError) throw new KioskError(placeError.message.replace(/^[A-Z0-9]+:\s*/, ""), 409);
  const p = placed as { id: string; folio: string; token: string };
  const row: OrderRow = { id: p.id, business_id: kiosk.business_id, branch_id: kiosk.branch_id, folio: p.folio, token: p.token, status: "nuevo", data: order, created_at: new Date().toISOString() };
  try {
    // Pedido ligado a la cuenta del socio: al aceptarlo, B-POS le suma al club
    if (member) await db.from("bpos_online_orders").update({ account_id: member.accountId }).eq("id", p.id);
    await sendToTerminal(db, kiosk, row, 1);
  } catch (e) {
    // La terminal no recibió el cobro: el pedido no se queda a medias
    await db.from("bpos_online_orders").delete().eq("id", p.id);
    throw e;
  }
  return { id: p.id, folio: p.folio, total: subtotal, status: "esperando", ...(member?.member ? { club: member.name } : {}) };
}

export type KioskPaymentStatus = {
  id: string;
  folio: string;
  total: number;
  status: "esperando" | "pagado" | "fallo";
  /** Qué pasó cuando falló (cancelado, vencido, tarjeta rechazada) */
  detail?: string;
  /** Pagado: la pantalla tiene impresora y el ticket del cliente va saliendo */
  ticket?: boolean;
};

const FAILED_STATUSES = new Set(["canceled", "cancelled", "expired", "failed", "refunded", "rejected"]);

function describeFailure(point: PointOrder) {
  const payment = point.transactions?.payments?.[0];
  const code = String(payment?.status_detail || point.status_detail || point.status || "");
  if (/expired/i.test(code) || point.status === "expired") return "Se acabó el tiempo para pagar.";
  if (/cancel/i.test(code) || /cancel/i.test(point.status)) return "El cobro se canceló en la terminal.";
  if (/insufficient/i.test(code)) return "La tarjeta no tiene fondos suficientes.";
  if (/rejected|declin|denied|bad_filled|blacklist|card_error|invalid/i.test(code)) return "La tarjeta fue rechazada.";
  return "No se pudo completar el pago.";
}

/** Guarda el pago aprobado en el pedido (igual que el pago en línea del menú). */
async function markPaid(db: SupabaseClient, kiosk: Kiosk, order: OrderRow, point: PointOrder) {
  if (order.data.mp?.status === "approved") return;
  const payment = point.transactions?.payments?.[0];
  const mp: OnlineMpPayment = {
    status: "approved",
    paymentId: String(payment?.id || point.id),
    amount: Number(payment?.amount || order.data.total),
    paidAt: new Date().toISOString(),
  };
  await db.from("bpos_online_orders").update({ data: { ...order.data, mp }, updated_at: new Date().toISOString() }).eq("id", order.id);
  await db.from("bpos_mp_charges").update({ status: point.status, updated_at: new Date().toISOString() }).eq("id", point.id);
  // Ticket del cliente en la impresora de la pantalla (si tiene); si falla, el pedido ya quedó pagado igual
  await printKioskTicket(db, kiosk, { ...order, data: { ...order.data, mp } }).catch(() => false);
}

/** La pantalla pregunta cómo va el cobro (cada par de segundos). */
export async function kioskOrderStatus(kiosk: Kiosk, id: string): Promise<KioskPaymentStatus> {
  const db = supabaseAdmin();
  const order = await findOrder(db, kiosk, id);
  const base = { id: order.id, folio: order.folio, total: Number(order.data.total) };
  const ticket = Boolean(kiosk.printer);
  if (order.data.mp?.status === "approved") return { ...base, status: "pagado", ticket };
  const chargeId = order.data.kiosk?.chargeId;
  if (!chargeId) return { ...base, status: "fallo", detail: "El cobro no llegó a la terminal." };
  const token = await merchantToken(kiosk.business_id);
  if (!token) return { ...base, status: "fallo", detail: "Mercado Pago se desvinculó." };
  const point = await getPointOrder(token, chargeId);
  const payment = point.transactions?.payments?.[0];
  if (point.status === "processed" && payment?.status !== "rejected") {
    await markPaid(db, kiosk, order, point);
    return { ...base, status: "pagado", ticket };
  }
  if (FAILED_STATUSES.has(point.status) || payment?.status === "rejected" || payment?.status === "cancelled") {
    await db.from("bpos_mp_charges").update({ status: point.status, updated_at: new Date().toISOString() }).eq("id", chargeId);
    return { ...base, status: "fallo", detail: describeFailure(point) };
  }
  return { ...base, status: "esperando" };
}

/** "Reintentar": otra orden de cobro para el mismo pedido. */
export async function retryKioskOrder(kiosk: Kiosk, id: string): Promise<KioskPaymentStatus> {
  const db = supabaseAdmin();
  const order = await findOrder(db, kiosk, id);
  if (order.data.mp?.status === "approved") return { id: order.id, folio: order.folio, total: Number(order.data.total), status: "pagado" };
  if (order.status !== "nuevo") throw new KioskError("Este pedido ya no se puede pagar. Haz uno nuevo.", 409);
  const token = await merchantToken(kiosk.business_id);
  if (token && order.data.kiosk?.chargeId) await cancelPointOrder(token, order.data.kiosk.chargeId).catch(() => undefined);
  const { count } = await db.from("bpos_mp_charges").select("id", { count: "exact", head: true }).like("reference", `kiosco-${order.id}-%`);
  await sendToTerminal(db, kiosk, order, (count || 1) + 1);
  return { id: order.id, folio: order.folio, total: Number(order.data.total), status: "esperando" };
}

/** El cliente se arrepintió: se cancela el cobro en la terminal y el pedido se borra. */
export async function cancelKioskOrder(kiosk: Kiosk, id: string) {
  const db = supabaseAdmin();
  const order = await findOrder(db, kiosk, id);
  if (order.data.mp?.status === "approved") throw new KioskError("Este pedido ya está pagado.", 409);
  const token = await merchantToken(kiosk.business_id);
  if (token && order.data.kiosk?.chargeId) {
    await cancelPointOrder(token, order.data.kiosk.chargeId).catch(() => undefined);
    // Si justo se pagó mientras se cancelaba, no se borra
    const point = await getPointOrder(token, order.data.kiosk.chargeId).catch(() => null);
    if (point?.status === "processed") {
      await markPaid(db, kiosk, order, point);
      throw new KioskError("El pago ya se había aprobado: tu pedido sigue.", 409);
    }
  }
  await db.from("bpos_online_orders").delete().eq("id", order.id).eq("status", "nuevo");
}

export { kioskLabel };
