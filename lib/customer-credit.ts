"use client";
/**
 * Fiado: la cuenta de cada cliente en la tienda ("me lo apuntas").
 *  - Al cobrar se elige "Fiado": la venta queda cargada a su cuenta (no
 *    entra dinero al cajón).
 *  - Cuando paga se registra un abono; si es en efectivo con la caja
 *    abierta, entra al cajón como ingreso (así el corte cuadra).
 *  - Cada cliente puede tener un límite; sin límite propio usa el general.
 * Se identifica por su WhatsApp (10 dígitos, el mismo del club) o, si no
 * lo dio, por su nombre. Cada movimiento es un renglón con id propio y se
 * sincroniza con las demás cajas del negocio.
 */
import { getCurrentUser } from "@/lib/auth";
import { addAuditEvent } from "@/lib/audit";
import { whatsappLink } from "@/lib/whatsapp";

export const CREDIT_KEY = "bpos_customer_credit";
export const CREDIT_SETTINGS_KEY = "bpos_customer_credit_settings";
export const CREDIT_EVENT = "bpos:customer-credit-updated";

export type CreditMovement = {
  id: string;
  /** Cuenta: "52xxxxxxxxxx"… no: los 10 dígitos del WhatsApp, o "n:nombre" */
  account: string;
  name: string;
  phone?: string;
  type: "cargo" | "abono" | "ajuste";
  /** Positivo; el cargo sube el saldo, el abono lo baja, el ajuste lleva signo en `delta` */
  amount: number;
  /** Solo ajuste: + sube la deuda, - la baja */
  delta?: number;
  orderId?: number | string;
  folio?: string;
  method?: string;
  note?: string;
  by?: string;
  createdAt: string;
};

export type CreditSettings = { defaultLimit: number; limits: Record<string, number> };

const round2 = (n: number) => Math.round(n * 100) / 100;
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export function phoneDigits(phone: string | undefined) {
  const d = String(phone || "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

/** Cuenta de un cliente: su WhatsApp, o su nombre si no hay */
export function accountKey(name: string, phone?: string) {
  const p = phoneDigits(phone);
  if (p) return p;
  const n = plain(name);
  return n ? `n:${n}` : "";
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function getCreditMovements(): CreditMovement[] {
  const list = read<CreditMovement[]>(CREDIT_KEY, []);
  return Array.isArray(list) ? list : [];
}

function saveMovements(list: CreditMovement[]) {
  window.localStorage.setItem(CREDIT_KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(CREDIT_EVENT));
}

export function getCreditSettings(): CreditSettings {
  const s = read<Partial<CreditSettings>>(CREDIT_SETTINGS_KEY, {});
  return { defaultLimit: Math.max(0, Number(s.defaultLimit) || 0), limits: s.limits && typeof s.limits === "object" ? s.limits : {} };
}

export function saveCreditSettings(patch: Partial<CreditSettings>) {
  const next = { ...getCreditSettings(), ...patch };
  window.localStorage.setItem(CREDIT_SETTINGS_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(CREDIT_EVENT));
  return next;
}

const effect = (m: CreditMovement) => (m.type === "cargo" ? m.amount : m.type === "abono" ? -m.amount : Number(m.delta) || 0);

export type CreditAccount = {
  account: string;
  name: string;
  phone?: string;
  balance: number;
  /** 0 = sin límite */
  limit: number;
  lastMove: string;
  /** Desde cuándo debe (el cargo más viejo que no se ha cubierto) */
  owingSince?: string;
  movements: CreditMovement[];
};

/** Todas las cuentas con su saldo (las que deben primero) */
export function creditAccounts(list = getCreditMovements(), settings = getCreditSettings()): CreditAccount[] {
  const map = new Map<string, CreditMovement[]>();
  for (const m of list) {
    if (!m?.account) continue;
    map.set(m.account, [...(map.get(m.account) || []), m]);
  }
  const accounts: CreditAccount[] = [];
  for (const [account, moves] of map) {
    moves.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const balance = round2(moves.reduce((s, m) => s + effect(m), 0));
    const last = moves[moves.length - 1];
    // Lo más viejo que se debe: se cubren los cargos en orden con lo abonado
    let paid = moves.filter((m) => effect(m) < 0).reduce((s, m) => s - effect(m), 0);
    let owingSince: string | undefined;
    for (const m of moves.filter((x) => effect(x) > 0)) {
      if (paid >= effect(m) - 0.001) paid -= effect(m);
      else {
        owingSince = m.createdAt;
        break;
      }
    }
    const named = [...moves].reverse().find((m) => m.name?.trim());
    const phoned = [...moves].reverse().find((m) => m.phone);
    accounts.push({
      account,
      name: named?.name || "Cliente",
      phone: phoned?.phone,
      balance,
      limit: settings.limits[account] ?? settings.defaultLimit,
      lastMove: last.createdAt,
      ...(balance > 0.009 ? { owingSince } : {}),
      movements: moves,
    });
  }
  return accounts.sort((a, b) => b.balance - a.balance || b.lastMove.localeCompare(a.lastMove));
}

export function creditAccount(account: string, list = getCreditMovements()) {
  return creditAccounts(list).find((a) => a.account === account) ?? null;
}

export function balanceOf(account: string, list = getCreditMovements()) {
  return round2(list.filter((m) => m.account === account).reduce((s, m) => s + effect(m), 0));
}

/** ¿Se le puede fiar esto? (con límite: no pasarlo) */
export function canCharge(account: string, amount: number) {
  const settings = getCreditSettings();
  const limit = settings.limits[account] ?? settings.defaultLimit;
  const balance = balanceOf(account);
  const available = limit > 0 ? round2(limit - balance) : null;
  return { ok: available === null || amount <= available + 0.001, balance, limit, available };
}

function stamp() {
  const u = getCurrentUser();
  return u?.id ? u.name : undefined;
}

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Venta fiada: se carga a la cuenta del cliente */
export function chargeCredit(input: { name: string; phone?: string; amount: number; orderId?: number | string; folio?: string; note?: string }) {
  const account = accountKey(input.name, input.phone);
  if (!account) throw new Error("Para fiar, escribe el nombre del cliente.");
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new Error("El importe fiado debe ser mayor a cero.");
  const list = getCreditMovements();
  // La misma venta no se carga dos veces
  if (input.orderId !== undefined && list.some((m) => m.type === "cargo" && String(m.orderId) === String(input.orderId) && m.account === account)) return null;
  const m: CreditMovement = { id: newId("fiado"), account, name: input.name.trim(), ...(phoneDigits(input.phone) ? { phone: phoneDigits(input.phone) } : {}), type: "cargo", amount, ...(input.orderId !== undefined ? { orderId: input.orderId } : {}), ...(input.folio ? { folio: input.folio } : {}), ...(input.note ? { note: input.note } : {}), by: stamp(), createdAt: new Date().toISOString() };
  saveMovements([...list, m]);
  addAuditEvent({ category: "Venta", action: "credit.charge", description: `${m.by || "Usuario"} fió $${amount.toFixed(2)} a ${m.name}${m.folio ? ` (Pedido #${m.folio})` : ""}. Debe $${balanceOf(account).toFixed(2)}.`, userName: m.by, entityId: account, metadata: m });
  return m;
}

/** Abono del cliente (paga parte o todo) */
export function payCredit(input: { account: string; amount: number; method: string; note?: string }) {
  const acc = creditAccount(input.account);
  if (!acc) throw new Error("Esa cuenta no existe.");
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new Error("Escribe cuánto abona.");
  if (amount > acc.balance + 0.001) throw new Error(`Debe $${acc.balance.toFixed(2)}: el abono no puede ser mayor.`);
  const m: CreditMovement = { id: newId("abono"), account: acc.account, name: acc.name, ...(acc.phone ? { phone: acc.phone } : {}), type: "abono", amount, method: input.method, ...(input.note ? { note: input.note } : {}), by: stamp(), createdAt: new Date().toISOString() };
  saveMovements([...getCreditMovements(), m]);
  addAuditEvent({ category: "Caja", action: "credit.payment", description: `${m.by || "Usuario"} registró un abono de $${amount.toFixed(2)} (${input.method}) de ${acc.name}. Debe $${round2(acc.balance - amount).toFixed(2)}.`, userName: m.by, entityId: acc.account, metadata: m });
  return m;
}

/** Venta fiada que se cancela: se quita de la cuenta */
export function reverseCreditForOrder(orderId: number | string, reason: string) {
  const list = getCreditMovements();
  const charges = list.filter((m) => m.type === "cargo" && String(m.orderId) === String(orderId));
  if (!charges.length) return 0;
  const already = list.filter((m) => m.type === "ajuste" && String(m.orderId) === String(orderId));
  if (already.length) return 0;
  const reversal = charges.map<CreditMovement>((c) => ({ id: newId("ajuste"), account: c.account, name: c.name, ...(c.phone ? { phone: c.phone } : {}), type: "ajuste", amount: c.amount, delta: -c.amount, orderId, note: `Venta cancelada: ${reason}`, by: stamp(), createdAt: new Date().toISOString() }));
  saveMovements([...list, ...reversal]);
  return reversal.reduce((s, m) => s + m.amount, 0);
}

/** Recordatorio amable de saldo por WhatsApp */
export function creditReminderText(acc: Pick<CreditAccount, "name" | "balance">, businessName: string) {
  const first = acc.name.trim().split(/\s+/)[0] || "";
  return `Hola ${first}, te saludamos de ${businessName}. Te recordamos que tu cuenta tiene un saldo de $${acc.balance.toFixed(2)}. Puedes pasar a abonar cuando gustes. ¡Gracias por tu preferencia!`;
}

export function creditReminderLink(acc: Pick<CreditAccount, "name" | "balance" | "phone">, businessName: string) {
  const phone = phoneDigits(acc.phone);
  if (!phone) return null;
  return whatsappLink(`52${phone}`, creditReminderText(acc, businessName));
}
