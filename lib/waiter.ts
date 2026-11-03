"use client";
/**
 * App de meseros (bpos.com.mx/meseros/<liga>): reglas y acciones.
 *
 *  - El celular se vincula una vez con el código de Configuración → Meseros
 *    (app/api/meseros). Queda como cuenta de dispositivo del negocio y
 *    sincroniza igual que una tablet.
 *  - El mesero entra con su nombre y PIN (Usuarios). Solo quien tenga el
 *    permiso "waiter.view" (rol Mesero de fábrica).
 *  - Puede mandar comandas solo si está en turno (marcó entrada en el
 *    checador, o el admin lo puso "siempre") y dentro del horario de
 *    servicio del menú digital. El admin puede abrir una excepción con PIN.
 */
import type { CartItem } from "@/components/CartPanel";
import type { SavedOrder } from "@/components/OrderHistoryPanel";
import { addAuditEvent } from "@/lib/audit";
import type { CurrentUser } from "@/lib/auth";
import { printSale, saleStations } from "@/lib/bridge/sale-tickets";
import { getDigitalMenu, isOpenNow, opensInLabel } from "@/lib/digital-menu";
import { discountInventoryByOrder } from "@/lib/inventory";
import { notifyKdsUpdated } from "@/lib/kds";
import { allocateShiftOrderNumber, formatOrderNumber } from "@/lib/order-sequence";
import { hasPermission } from "@/lib/permissions";
import { loadSavedOrders } from "@/lib/sale-actions";
import { getSupabase } from "@/lib/supabase/client";
import { openTableOrder, tableLabel, type Table } from "@/lib/tables";
import { MAX_SHIFT_HOURS, lastPunch } from "@/lib/timeclock";
import { getUsers, type SystemUser } from "@/lib/users";

export const WAITER_DEVICE_KEY = "bpos_waiter_device";
const OVERRIDE_KEY = "bpos_waiter_override"; // excepción del admin (fuera de horario / sin turno), por 2 horas
const ORDERS_KEY = "bpos_orders";
const OVERRIDE_MS = 2 * 60 * 60 * 1000;

export type WaiterDevice = { deviceId: string; branchId: string; name: string; slug: string; linkedAt: string };

export function readWaiterDevice(): WaiterDevice | null {
  try {
    const raw = localStorage.getItem(WAITER_DEVICE_KEY);
    const d = raw ? (JSON.parse(raw) as WaiterDevice) : null;
    return d && typeof d.deviceId === "string" ? d : null;
  } catch {
    return null;
  }
}
export function saveWaiterDevice(device: WaiterDevice | null) {
  if (device) localStorage.setItem(WAITER_DEVICE_KEY, JSON.stringify(device));
  else localStorage.removeItem(WAITER_DEVICE_KEY);
}

// ------------------------------------------------------------ API (app/api/meseros)

async function session() {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token || "";
}
async function call<T>(method: string, query = "", body?: unknown): Promise<T> {
  const token = await session();
  const response = await fetch(`/api/meseros${query}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as T & { success?: boolean; error?: string };
  if (!response.ok || payload.success === false) throw new Error(payload.error || "No se pudo.");
  return payload;
}
export type WaiterDeviceRow = { id: string; name: string; created_at: string; last_seen_at: string | null };
export const listWaiterDevices = (branchId: string) => call<{ devices: WaiterDeviceRow[] }>("GET", `?branch=${encodeURIComponent(branchId)}`).then((r) => r.devices);
export const newWaiterCode = (branchId: string) => call<{ code: string; expiresAt: string }>("POST", "", { accion: "codigo", branchId });
export const revokeWaiterDevice = (id: string) => call<unknown>("DELETE", `?id=${encodeURIComponent(id)}`);
/** Desde el celular (sin sesión): vincula y regresa con qué entrar */
export const linkWaiterDevice = (slug: string, code: string, name: string) =>
  call<{ email: string; password: string; deviceId: string; branchId: string; name: string }>("POST", "", { accion: "vincular", slug, code, name });

// ------------------------------------------------------------ quién puede

/** Usuarios que pueden tomar órdenes como meseros (permiso waiter.view, activos) */
export function waiterUsers(): SystemUser[] {
  return getUsers().filter((u) => u.active && hasPermission({ id: u.id, role: u.role }, "waiter.view"));
}

/** ¿Está en turno? Según el checador (entrada de hace menos de MAX_SHIFT_HOURS), salvo que el admin lo haya puesto siempre o lo haya cortado. */
export function waiterOnShift(user: Pick<SystemUser, "id" | "waiterAccess">, now = Date.now()): boolean {
  if (user.waiterAccess === "block") return false;
  if (user.waiterAccess === "allow") return true;
  const last = lastPunch(user.id);
  return Boolean(last && last.type === "entrada" && now - Date.parse(last.at) < MAX_SHIFT_HOURS * 3600_000);
}

export type WaiterBlock = { kind: "turno" | "horario" | "cortado"; message: string } | null;

/** Por qué no puede mandar comandas ahora (null = puede). */
export function waiterBlock(user: Pick<SystemUser, "id" | "name" | "waiterAccess">, now = new Date()): WaiterBlock {
  if (hasOverride()) return null;
  if (user.waiterAccess === "block") return { kind: "cortado", message: "El administrador cortó tus comandas por ahora. Pregunta en caja." };
  if (!waiterOnShift(user, now.getTime())) return { kind: "turno", message: "No estás en turno. Marca tu entrada en el checador de la caja y vuelve a entrar." };
  const menu = getDigitalMenu();
  if (!isOpenNow(menu, now)) {
    const opens = opensInLabel(menu, now);
    return { kind: "horario", message: `Fuera del horario de servicio${opens ? ` (abrimos ${opens})` : ""}. Las comandas están cerradas.` };
  }
  return null;
}

/** Excepción del admin (con su PIN): comandas aunque esté fuera de horario o sin turno, 2 horas */
export function hasOverride(now = Date.now()) {
  try {
    const until = Number(sessionStorage.getItem(OVERRIDE_KEY) || 0);
    return until > now;
  } catch {
    return false;
  }
}
export function setOverride(now = Date.now()) {
  sessionStorage.setItem(OVERRIDE_KEY, String(now + OVERRIDE_MS));
}

// ------------------------------------------------------------ comandas

function saveOrders(orders: SavedOrder[]) {
  localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
  window.dispatchEvent(new Event("bpos:orders-updated"));
}

/** Cuentas de mesa abiertas (por cobrar, no canceladas) */
export function openTableOrders(): SavedOrder[] {
  return loadSavedOrders().filter((o) => o.pendingPayment && !o.cancelled && o.details.table);
}

export type SendResult = { order: SavedOrder; round: number; failed: string[] };

/**
 * Manda lo marcado a cocina para una mesa: abre la cuenta (ronda 1) o le
 * agrega otra ronda. Misma lógica que el POS (folio del turno, KDS,
 * comandas por estación, inventario, bitácora).
 */
export async function sendToKitchen(cart: CartItem[], table: Table, diners: number, user: CurrentUser): Promise<SendResult> {
  if (cart.length === 0) throw new Error("No hay nada en la orden.");
  const orders = loadSavedOrders();
  const open = openTableOrder(orders, table.id);
  const tableRef = { id: table.id, name: table.name, zone: table.zone };
  const by = user.name;

  if (open) {
    const round = (open.rounds || 1) + 1;
    const newItems: CartItem[] = cart.map((item) => ({ ...item, round }));
    const items: CartItem[] = [...open.items.map((item) => ({ ...item, kdsDone: true })), ...newItems];
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const updated = {
      ...open,
      items,
      subtotal,
      total: Math.max(0, subtotal - (open.details.discount || 0)) + (open.details.deliveryFee || 0),
      rounds: round,
      kdsCompleted: false,
      kdsCompletedAt: undefined,
      status: "Nuevo",
    } as SavedOrder;
    saveOrders(orders.map((o) => (o.id === open.id ? updated : o)));
    notifyKdsUpdated(open.id);
    discountInventoryByOrder(`${open.id}-r${round}`, cart);
    const failed = await printSale({ ...updated, items: newItems }, { stations: saleStations({ ...updated, items: newItems }), customer: false }, true).catch(() => ["cocina: B-POS Agent no respondió"]);
    addAuditEvent({ category: "Venta", action: "sale.round", description: `${by} (mesero) mandó la ronda ${round} de ${tableLabel(tableRef)} (Pedido #${formatOrderNumber(updated as SavedOrder & { localOrderNumber?: number })}): ${cart.map((i) => `${i.quantity}x ${i.name}`).join(", ")}`, userId: String(user.id), userName: by, entityId: String(open.id), metadata: { round, total: updated.total, waiter: true } });
    return { order: updated, round, failed };
  }

  const sequence = allocateShiftOrderNumber(); // lanza si la caja está cerrada
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const id = orders.reduce((max, o) => Math.max(max, Number(o.id) || 0), 0) + 1;
  const order = {
    id,
    localOrderNumber: sequence.localOrderNumber,
    shiftSessionId: sequence.shiftSessionId,
    createdAt: new Date().toISOString(),
    items: cart.map((item) => ({ ...item, round: 1 })),
    details: { orderType: "Mesa", customerName: `Mesa ${table.name}`, customerPhone: "", customerAddress: "", paymentMethod: "Efectivo", discount: 0, table: tableRef, diners, waiter: by },
    subtotal,
    total: subtotal,
    pendingPayment: true,
    rounds: 1,
  } as SavedOrder & { localOrderNumber: number; shiftSessionId: string };
  saveOrders([...orders, order]);
  notifyKdsUpdated(order.id);
  discountInventoryByOrder(order.id, cart);
  const failed = await printSale(order, { stations: saleStations(order), customer: false }, false).catch(() => ["cocina: B-POS Agent no respondió"]);
  addAuditEvent({ category: "Venta", action: "sale.created", description: `${by} (mesero) abrió ${tableLabel(tableRef, diners)} (Pedido #${formatOrderNumber(order)}) por $${subtotal.toFixed(2)}: ${cart.map((i) => `${i.quantity}x ${i.name}`).join(", ")}`, userId: String(user.id), userName: by, entityId: String(order.id), metadata: { total: subtotal, pending: true, waiter: true, shiftSessionId: sequence.shiftSessionId } });
  return { order, round: 1, failed };
}

/** Precuenta de la mesa en la impresora de Caja (sin cobrar) */
export async function printTablePrecuenta(order: SavedOrder, user: CurrentUser) {
  const failed = await printSale({ ...order, details: { ...order.details, precuenta: true } } as SavedOrder, { stations: [], customer: true }, true);
  addAuditEvent({ category: "Venta", action: "sale.precuenta", description: `${user.name} (mesero) sacó la precuenta de ${tableLabel(order.details.table)} (Pedido #${formatOrderNumber(order as SavedOrder & { localOrderNumber?: number })})`, userId: String(user.id), userName: user.name, entityId: String(order.id) });
  return failed;
}

/** Intento bloqueado (sin turno / fuera de horario): queda en la bitácora y le avisa al dueño */
export function reportBlockedAttempt(user: CurrentUser, block: NonNullable<WaiterBlock>, table?: Table) {
  addAuditEvent({ category: "Seguridad", action: "waiter.blocked", description: `${user.name} intentó mandar una comanda${table ? ` de ${tableLabel(table)}` : ""} ${block.kind === "horario" ? "fuera del horario de servicio" : block.kind === "cortado" ? "con las comandas cortadas" : "sin estar en turno"}.`, userId: String(user.id), userName: user.name, metadata: { kind: block.kind } });
}
