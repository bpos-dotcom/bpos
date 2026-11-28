/**
 * Motor de sincronización de B-POS con Supabase.
 *
 * B-POS guarda todo en localStorage (llaves "bpos_*"). En lugar de
 * reescribir cada pantalla, este motor:
 *   1. intercepta cada escritura a localStorage de una llave bpos_*,
 *   2. la sube a la tabla sync_records (registro por registro cuando la
 *      llave es una lista con id, o el documento completo si no),
 *   3. descarga los cambios de los demás dispositivos (tiempo real +
 *      revisión periódica) y los escribe en localStorage, avisando a las
 *      pantallas con los mismos eventos que ya escuchan.
 *
 * Funciona sin internet: los cambios quedan pendientes y se suben al
 * volver la conexión.
 */
import { isQuotaError, slimOrdersText } from "@/lib/order-slim";
import { isArchivedOrder, localOrdersCutoff } from "@/lib/order-archive";
import { resolveShiftPush, type ShiftDoc } from "@/lib/cloud/shift-guard";
import { mergeInventoryItem } from "@/lib/cloud/inventory-merge";
import { archiveIds, KARDEX_ARCHIVE_COLLECTION, localKardexCutoff, splitKardex } from "@/lib/kardex-archive";
import {
  applyRowChanges,
  cloudCollection,
  isRowKey,
  LEGACY_DOC_COLLECTIONS,
  localKeyOf,
  rememberSeqs,
  ROW_KEYS,
  rowListOf,
  unseenSeqs,
} from "@/lib/cloud/row-keys";
import type { ReadyAccount } from "@/lib/cloud/account";
import { friendlyError, getSupabase } from "@/lib/supabase/client";

// ------------------------------------------------------------ configuración

/** Llaves que pertenecen a este dispositivo y nunca se sincronizan */
const DEVICE_LOCAL_KEYS = new Set([
  "bpos_current_user",
  "bpos_session_alive",
  "bpos_waiter_device",
  "bpos_kds_device", // tablet de cocina vinculada (/kds/<liga>)
  "bpos_local_agent",
  "bpos_offline_warm",
  "bpos_license",
  "bpos_license_seen",
  "bpos_license_ever",
  "bpos_license_offset",
  "bpos_device_id",
  "bpos_plan",
  "bpos_branch_id",
  "bpos_bridge_pending_ack",
  "bpos_bridge_pending_signature",
  "bpos_device_role",
  "bpos_owner_notify",
  "bpos_last_backup",
  "bpos_audit_outbox",
  "bpos_push_outbox",
  "bpos_push_prefs",
  "bpos_push_on",
  "bpos_sidebar_collapsed",
  "bpos_sidebar_pinned",
  "bpos_touch_keypad",
  "bpos_whatsapp_app",
  "bpos_theme",
  "bpos_pos_draft", // pedido en curso de ESTA caja (otra caja tiene el suyo)
  "bpos_tables_view", // plano o cuadrícula en la ventana de Mesas de esta caja
  "bpos_pos_view", // productos en cuadrícula o lista en el POS de esta caja
  "bpos_drawer_suspects", // cobros cerrados con el cajón abierto, esperando a ver si se cobran
  "bpos_productivity_rang", // cuándo sonó en ESTA caja cada recordatorio
  "bpos_productivity_owner_told", // avisos de "sin atender" que ya mandó esta caja
  "bpos_phone_scanner", // llave del celular ligado como escáner a ESTA caja (lib/phone-scanner.ts)
]);

/** Llaves compartidas por todas las sucursales del negocio */
const BUSINESS_KEYS = new Set([
  "bpos_app_commissions",
  "bpos_products",
  "bpos_brands",
  "bpos_recipes",
  "bpos_recipe_equivalence_log",
  "bpos_users",
  "bpos_user_permissions",
  "bpos_payment_methods",
  "bpos_business_settings",
  "bpos_suppliers",
  "bpos_purchase_aliases",
  "bpos_bridge_aliases",
  "bpos_purchase_ticket_templates_v1",
  "bpos_ingredient_cost_history",
  "bpos_notification_settings",
  "bpos_drivers",
  "bpos_tables",
  "bpos_coupons",
  "bpos_customers",
  "bpos_loyalty",
  "bpos_customer_credit", // fiado: renglón por movimiento (lib/customer-credit.ts)
  "bpos_customer_credit_settings",
  "bpos_photo_gallery",
]);

/** Eventos que ya escuchan las pantallas de B-POS */
const APP_EVENTS = [
  "bpos:audit-updated",
  "bpos:brands-updated",
  "bpos:business-settings-updated",
  "bpos:cash-history-updated",
  "bpos:critical-errors-updated",
  "bpos:inventory-alerts-updated",
  "bpos:inventory-updated",
  "bpos:kds-config-updated",
  "bpos:kds-updated",
  "bpos:operations-alerts-updated",
  "bpos:orders-updated",
  "bpos:payment-methods-updated",
  "bpos:permissions-updated",
  "bpos:photo-gallery-updated",
  "bpos:productivity-updated",
  "bpos:purchase-ticket-templates-updated",
  "bpos:purchases-updated",
  "bpos:shift-updated",
  "bpos:users-updated",
];

const META_KEY = "bpos_sync_meta";
const SHADOW_KEY = "bpos_sync_shadow";
const DIRTY_KEY = "bpos_sync_dirty";
const DEVICE_KEY = "bpos_device_id";
const DOC_ID = "__doc__";
const PAGE_SIZE = 1000;
const UPSERT_BATCH = 200;
/**
 * Se vuelve a leer un poco hacia atrás por si un cambio llegó fuera de orden.
 * Normalmente poquito (cada revisión cuenta como tráfico de Supabase: con 200
 * se bajaban ~0.5 MB cada 20 s por equipo y se pasó el límite del plan); la
 * revisión amplia, una vez cada 10 minutos.
 */
const SEQ_OVERLAP = 20;
const SEQ_OVERLAP_WIDE = 200;
const WIDE_EVERY_MS = 10 * 60 * 1000;
let lastWidePull = 0;

export function shouldSync(key: string | null | undefined): key is string {
  return (
    typeof key === "string" &&
    key.startsWith("bpos_") &&
    !key.startsWith("bpos_sync_") &&
    !DEVICE_LOCAL_KEYS.has(key)
  );
}

// ------------------------------------------------------------ estado

type SyncMeta = { businessId: string; branchId: string; lastSeq: number };
type Shadow = Record<string, Record<string, string>>; // llave → id → hash

export type SyncStatus = {
  state: "idle" | "syncing" | "ok" | "offline" | "error";
  pending: number;
  lastSyncAt?: string;
  message?: string;
};

type Row = {
  collection: string;
  record_id: string;
  data: unknown;
  deleted: boolean;
  seq: number;
};

let account: ReadyAccount | null = null;
let rawSet: (key: string, value: string) => void = () => undefined;
let rawRemove: (key: string) => void = () => undefined;
let rawGet: (key: string) => string | null = () => null;
let shadow: Shadow = {};
let meta: SyncMeta | null = null;
/** Estado del canal de tiempo real ("SUBSCRIBED" = llegan los avisos al instante) */
let liveStatus = "CONNECTING";

/** Cada cuánto revisar la nube por si un aviso no llegó */
export function pollEveryMs(live: boolean, visible: boolean) {
  if (live) return visible ? 60_000 : 120_000;
  return visible ? 10_000 : 30_000;
}
let dirty = new Set<string>();
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pullTimer: ReturnType<typeof setTimeout> | null = null;
let chain: Promise<unknown> = Promise.resolve();
let started = false;
let status: SyncStatus = { state: "idle", pending: 0 };
const listeners = new Set<(s: SyncStatus) => void>();

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch, pending: dirty.size };
  listeners.forEach((listener) => listener(status));
}

export function onSyncStatus(listener: (s: SyncStatus) => void) {
  listeners.add(listener);
  listener(status);
  return () => {
    listeners.delete(listener);
  };
}

/** Las operaciones de red van en fila, una tras otra */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  chain = next.catch(() => undefined);
  return next;
}

// ------------------------------------------------------------ utilidades

function bindRawStorage() {
  const storage = window.localStorage;
  const proto = Object.getPrototypeOf(storage) as Storage;
  const originalSet = (window as unknown as { __bposRawSet?: Storage["setItem"] }).__bposRawSet ?? proto.setItem;
  const originalRemove =
    (window as unknown as { __bposRawRemove?: Storage["removeItem"] }).__bposRawRemove ?? proto.removeItem;
  // Las ventas cerradas se guardan sin la copia completa del producto (ver lib/order-slim.ts)
  rawSet = (k, v) => originalSet.call(storage, k, k === ORDERS_COLLECTION ? slimOrdersText(v) : v);
  rawRemove = (k) => originalRemove.call(storage, k);
  rawGet = (k) => proto.getItem.call(storage, k);
  return { proto, originalSet, originalRemove };
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = rawGet(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Lo interno de la sincronización nunca debe tumbar la caja (ej. memoria llena) */
function safeSet(key: string, value: string) {
  try {
    rawSet(key, value);
  } catch (e) {
    console.warn("[sync] no se pudo guardar", key, e);
  }
}

function saveShadow() {
  safeSet(SHADOW_KEY, JSON.stringify(shadow));
}

function saveMeta() {
  if (meta) safeSet(META_KEY, JSON.stringify(meta));
}

function saveDirty() {
  safeSet(DIRTY_KEY, JSON.stringify([...dirty]));
}

/** Lo que se puede recortar si la memoria se llena */
const DISPOSABLE_KEYS = ["bpos_audit_log", "bpos_operations_center_alerts"];

/** Últimos 200 de la auditoría; de los avisos, solo los que siguen sin resolver */
export function trimmedDisposable(key: string, raw: string): string {
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return raw;
    if (key === "bpos_audit_log") return JSON.stringify(list.slice(0, 200));
    return JSON.stringify(list.filter((a: { status?: string }) => a?.status !== "resolved").slice(0, 100));
  } catch {
    return raw;
  }
}

function freeDisposableSpace(storage: Storage, set: Storage["setItem"], except: string) {
  for (const key of DISPOSABLE_KEYS) {
    if (key === except) continue;
    // Del prototipo del propio almacén: en la caja local (B-POS Agent) no es un Storage del navegador
    const raw = (Object.getPrototypeOf(storage) as Storage).getItem.call(storage, key);
    if (!raw) continue;
    try {
      set.call(storage, key, trimmedDisposable(key, raw));
    } catch {
      /* si ni así cabe, se deja */
    }
  }
}

/** Aligera las ventas ya guardadas. Regresa true si cambió algo. */
function compactOrders() {
  const raw = rawGet(ORDERS_COLLECTION);
  if (!raw) return false;
  const slim = slimOrdersText(raw);
  if (slim === raw) return false;
  try {
    rawSet(ORDERS_COLLECTION, slim);
    return true;
  } catch (e) {
    console.warn("[sync] no se pudieron aligerar las ventas", e);
    return false;
  }
}

/**
 * Solo los últimos 10 días se quedan en la caja: las ventas cerradas más
 * viejas que ya están en la nube tal cual se quitan de la memoria (y de la
 * sombra, para que NO se suban como borradas). Se consultan en la nube.
 */
function pruneArchivedOrders() {
  const parsed = parseValue(rawGet(ORDERS_COLLECTION));
  if (parsed.mode !== "records") return;
  const cutoff = localOrdersCutoff();
  const keyShadow = shadow[ORDERS_COLLECTION] ?? {};
  const removed: string[] = [];
  const kept = parsed.list.filter((order, i) => {
    const id = parsed.ids[i];
    if (!isArchivedOrder(order, cutoff) || !keyShadow[id] || keyShadow[id] !== hash(JSON.stringify(order))) return true;
    removed.push(id);
    return false;
  });
  if (!removed.length) return;
  try {
    rawSet(ORDERS_COLLECTION, JSON.stringify(kept));
  } catch (e) {
    console.warn("[sync] no se pudieron quitar las ventas viejas", e);
    return;
  }
  removed.forEach((id) => delete keyShadow[id]);
  shadow[ORDERS_COLLECTION] = keyShadow;
  saveShadow();
  notifyApp([ORDERS_COLLECTION]);
}

const KARDEX_KEY = "bpos_inventory_kardex";

/**
 * El kardex viejo (antes de los últimos días) se sube a la nube en una
 * colección aparte y se quita de la caja (ver lib/kardex-archive.ts). Solo
 * se quita lo que la nube confirmó; si algo falla, se queda para la próxima.
 */
async function archiveOldKardex() {
  if (!account) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  const parsed = parseValue(rawGet(KARDEX_KEY));
  if (parsed.mode === "missing") return;
  const list = parsed.mode === "records" ? parsed.list : Array.isArray(parsed.value) ? (parsed.value as unknown[]) : null;
  if (!list) return;
  const cutoff = localKardexCutoff();
  const { old } = splitKardex(list, cutoff);
  if (!old.length) return;
  const ids = archiveIds(old);
  const scope = scopeFor(KARDEX_KEY);
  const device = getDeviceId();
  try {
    for (let i = 0; i < old.length; i += UPSERT_BATCH) {
      const rows = old.slice(i, i + UPSERT_BATCH).map((data, j) => ({
        business_id: account!.businessId,
        scope,
        collection: KARDEX_ARCHIVE_COLLECTION,
        record_id: ids[i + j],
        data,
        deleted: false,
        updated_by: device,
      }));
      const { error } = await getSupabase().from("sync_records").upsert(rows, { onConflict: "business_id,scope,collection,record_id" });
      if (error) throw new Error(friendlyError(error));
    }
  } catch (e) {
    console.warn("[sync] no se pudo guardar el kardex viejo en la nube", e);
    return;
  }
  // Mientras subía pudo llegar otro movimiento: se vuelve a leer y solo se quita lo que ya está en la nube
  const now = parseValue(rawGet(KARDEX_KEY));
  const current = now.mode === "records" ? now.list : now.mode === "doc" && Array.isArray(now.value) ? (now.value as unknown[]) : null;
  if (!current) return;
  const uploaded = new Set(ids);
  const split = splitKardex(current, cutoff);
  const oldIds = archiveIds(split.old);
  const left = split.old.filter((_, i) => !uploaded.has(oldIds[i]));
  try {
    rawSet(KARDEX_KEY, JSON.stringify([...left, ...split.keep]));
  } catch (e) {
    console.warn("[sync] no se pudo aligerar el kardex", e);
    return;
  }
  markDirty(KARDEX_KEY);
  notifyApp([KARDEX_KEY]);
}

/** Kardex de la nube de esta sucursal entre dos fechas (lo que ya no está en la caja) */
export async function fetchCloudKardex(from: Date, to: Date): Promise<unknown[]> {
  if (!account) return [];
  const all: unknown[] = [];
  for (let page = 0; ; page += 1) {
    const { data, error } = await getSupabase()
      .from("sync_records")
      .select("data")
      .eq("business_id", account.businessId)
      .eq("scope", account.branchId)
      .eq("collection", KARDEX_ARCHIVE_COLLECTION)
      .eq("deleted", false)
      .gte("data->>createdAt", from.toISOString())
      .lt("data->>createdAt", to.toISOString())
      .order("record_id", { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw new Error(friendlyError(error));
    const rows = (data ?? []) as { data: unknown }[];
    rows.forEach((r) => r.data && all.push(r.data));
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

/** Ventas de la nube de esta sucursal entre dos fechas (lo que ya no está en la caja) */
export async function fetchCloudOrders(from: Date, to: Date): Promise<unknown[]> {
  if (!account) return [];
  const all: unknown[] = [];
  for (let page = 0; ; page += 1) {
    const { data, error } = await getSupabase()
      .from("sync_records")
      .select("data")
      .eq("business_id", account.businessId)
      .eq("scope", account.branchId)
      .eq("collection", ORDERS_COLLECTION)
      .eq("deleted", false)
      .gte("data->>createdAt", from.toISOString())
      .lt("data->>createdAt", to.toISOString())
      .order("seq", { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw new Error(friendlyError(error));
    const rows = (data ?? []) as { data: unknown }[];
    rows.forEach((r) => r.data && all.push(r.data));
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

export function getDeviceId() {
  let id = rawGet(DEVICE_KEY);
  if (!id) {
    id = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    rawSet(DEVICE_KEY, id);
  }
  return id;
}

function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}.${text.length}`;
}

type Parsed =
  | { mode: "missing" }
  | { mode: "records"; list: Record<string, unknown>[]; ids: string[] }
  | { mode: "doc"; value: unknown };

function parseValue(raw: string | null): Parsed {
  if (raw === null) return { mode: "missing" };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { mode: "doc", value: raw };
  }

  if (Array.isArray(value)) {
    const ids: string[] = [];
    const seen = new Set<string>();
    const isRecordList = value.every((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const id = (item as { id?: unknown }).id;
      if (typeof id !== "string" && typeof id !== "number") return false;
      const key = String(id);
      if (seen.has(key)) return false;
      seen.add(key);
      ids.push(key);
      return true;
    });
    if (isRecordList) return { mode: "records", list: value as Record<string, unknown>[], ids };
  }

  return { mode: "doc", value };
}

/** Versión del valor que se guarda en la nube, id → contenido */
function toEntries(key: string, raw: string | null): Map<string, unknown> {
  const map = new Map<string, unknown>();
  // Listas sin id único (kardex…): renglón por renglón con un id calculado (ver row-keys.ts)
  if (isRowKey(key)) {
    const list = rowListOf(raw);
    const ids = ROW_KEYS[key](list);
    list.forEach((item, i) => map.set(ids[i], item));
    return map;
  }
  const parsed = parseValue(raw);
  if (parsed.mode === "records") parsed.list.forEach((item, i) => map.set(parsed.ids[i], item));
  if (parsed.mode === "doc") map.set(DOC_ID, parsed.value);
  return map;
}

function scopeFor(key: string) {
  return BUSINESS_KEYS.has(key) ? "business" : account!.branchId;
}

function timestampOf(item: unknown): string | undefined {
  if (!item || typeof item !== "object") return undefined;
  const o = item as Record<string, unknown>;
  const value = o.createdAt ?? o.openedAt ?? o.receivedAt ?? o.timestamp ?? o.purchasedAt ?? o.date;
  return typeof value === "string" ? value : undefined;
}

/** Inserta un registro nuevo respetando el orden (por fecha) de la lista */
function insertOrdered(list: unknown[], item: unknown) {
  const ts = timestampOf(item);
  const first = timestampOf(list[0]);
  const last = timestampOf(list[list.length - 1]);
  if (!ts || !first || !last || list.length < 2) {
    if (ts && first && list.length === 1 && ts < first) list.unshift(item);
    else list.push(item);
    return;
  }
  const descending = first > last;
  const index = list.findIndex((existing) => {
    const other = timestampOf(existing);
    if (!other) return false;
    return descending ? ts > other : ts < other;
  });
  if (index === -1) list.push(item);
  else list.splice(index, 0, item);
}

function notifyApp(keys: string[]) {
  keys.forEach((key) => {
    try {
      window.dispatchEvent(
        // storageArea solo acepta el Storage del navegador (la caja local guarda en el disco)
        new StorageEvent("storage", {
          key,
          newValue: rawGet(key),
          ...(typeof Storage !== "undefined" && window.localStorage instanceof Storage ? { storageArea: window.localStorage } : {}),
        })
      );
    } catch {
      window.dispatchEvent(new Event("storage"));
    }
  });
  APP_EVENTS.forEach((name) => window.dispatchEvent(new Event(name)));
}

// ------------------------------------------------------------ pedidos: cobro y cancelación

const ORDERS_COLLECTION = "bpos_orders";
const PAID_FIELDS = ["pendingPayment", "paidAt", "paidBy", "paidShiftSessionId", "tip", "tipPayments", "partialPayments"];
const PAID_DETAILS = ["paymentMethod", "payments", "couponCode"];
const CANCEL_FIELDS = ["cancelled", "cancelledAt", "cancelledBy", "cancelReason"];

type Obj = Record<string, unknown>;

function copyFields(target: Obj, source: Obj, fields: string[]) {
  fields.forEach((field) => {
    if (field in source) target[field] = source[field];
    else delete target[field];
  });
}

/**
 * Un pedido cobrado o cancelado no vuelve atrás. Si un dispositivo tenía una
 * copia vieja (por ejemplo la pantalla de cocina, que estuvo apagada) y la
 * cambia, se respeta el cobro o la cancelación que ya está en la nube.
 */
export function keepMoneyState(local: Obj, cloud: Obj): Obj {
  let merged = local;
  if (local.pendingPayment === true && cloud.pendingPayment !== true && !local.cancelled) {
    merged = { ...merged, details: { ...((merged.details as Obj) || {}) } };
    copyFields(merged, cloud, PAID_FIELDS);
    copyFields(merged.details as Obj, (cloud.details as Obj) || {}, PAID_DETAILS);
  }
  if (cloud.cancelled === true && merged.cancelled !== true) {
    merged = { ...merged };
    copyFields(merged, cloud, CANCEL_FIELDS);
  }
  return merged;
}

/** Antes de subir pedidos que otro dispositivo cambió, conserva su cobro o cancelación */
async function keepOrdersMoneyState(rows: Obj[], scope: string, previous: Record<string, string>, nextHashes: Record<string, string>) {
  const ids = rows.filter((row) => !row.deleted).map((row) => String(row.record_id));
  const cloud = new Map<string, Obj>();
  for (let i = 0; i < ids.length; i += UPSERT_BATCH) {
    const { data, error } = await getSupabase()
      .from("sync_records")
      .select("record_id, data")
      .eq("business_id", account!.businessId)
      .eq("scope", scope)
      .eq("collection", ORDERS_COLLECTION)
      .in("record_id", ids.slice(i, i + UPSERT_BATCH));
    if (error) throw new Error(friendlyError(error));
    (data ?? []).forEach((row) => row.data && cloud.set(String(row.record_id), row.data as Obj));
  }

  // id → [cómo estaba aquí, cómo queda]
  const fixed = new Map<string, [string, Obj]>();
  rows.forEach((row) => {
    const id = String(row.record_id);
    const remote = cloud.get(id);
    if (!remote || row.deleted) return;
    if (hash(JSON.stringify(remote)) === previous[id]) return; // nadie más lo cambió
    const merged = keepMoneyState(row.data as Obj, remote);
    if (merged === row.data) return;
    fixed.set(id, [hash(JSON.stringify(row.data)), merged]);
    row.data = merged;
    nextHashes[id] = hash(JSON.stringify(merged));
  });
  if (fixed.size === 0) return;

  // Este dispositivo también se queda con el cobro (si no cambió el pedido mientras tanto)
  const parsed = parseValue(rawGet(ORDERS_COLLECTION));
  if (parsed.mode !== "records") return;
  const list = parsed.list.map((item, i) => {
    const fix = fixed.get(parsed.ids[i]);
    return fix && hash(JSON.stringify(item)) === fix[0] ? fix[1] : item;
  });
  rawSet(ORDERS_COLLECTION, JSON.stringify(list));
  notifyApp([ORDERS_COLLECTION]);
}

// ------------------------------------------------------------ subir

function markDirty(key: string) {
  dirty.add(key);
  saveDirty();
  setStatus({});
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void flush(), 500);
}

const SHIFT_KEY = "bpos_active_shift";

/**
 * Antes de subir la caja abierta: si otro equipo la cambió desde la última
 * vez que este la vio, gana la nube (ver shift-guard.ts). Regresa true si
 * hay que subir lo de este equipo.
 */
async function guardShiftPush(key: string): Promise<boolean> {
  const scope = scopeFor(key);
  const { data, error } = await getSupabase()
    .from("sync_records")
    .select("data, deleted")
    .eq("business_id", account!.businessId)
    .eq("scope", scope)
    .eq("collection", cloudCollection(key))
    .eq("record_id", DOC_ID)
    .limit(1);
  if (error) throw new Error(friendlyError(error));
  const row = (data ?? [])[0] as { data: unknown; deleted: boolean } | undefined;
  const cloud = row && !row.deleted && row.data && typeof row.data === "object" ? (row.data as ShiftDoc) : null;
  const cloudHash = cloud ? hash(JSON.stringify(cloud)) : undefined;
  const seen = shadow[key]?.[DOC_ID];
  const parsed = parseValue(rawGet(key));
  const local = parsed.mode === "doc" && parsed.value && typeof parsed.value === "object" ? (parsed.value as ShiftDoc) : null;
  const decision = resolveShiftPush(local, cloud, cloudHash !== seen);
  if (decision.action === "push") {
    if (decision.value !== local) rawSet(key, JSON.stringify(decision.value));
    return true;
  }
  // Este equipo estaba atrasado: se queda con la caja de la nube y no sube nada
  if (decision.value) {
    rawSet(key, JSON.stringify(decision.value));
    shadow[key] = { [DOC_ID]: cloudHash! };
  } else {
    rawRemove(key);
    delete shadow[key];
  }
  saveShadow();
  notifyApp([key]);
  return false;
}

async function pushKey(key: string) {
  if (!account) return;
  if (key === SHIFT_KEY && !(await guardShiftPush(key))) return;
  const current = toEntries(key, rawGet(key));
  const previous = { ...(shadow[key] ?? {}) };
  // El documento completo de antes no se borra de la nube: lo siguen usando los equipos sin actualizar
  if (isRowKey(key)) delete previous[DOC_ID];
  const nextHashes: Record<string, string> = {};
  const rows: Record<string, unknown>[] = [];
  const device = getDeviceId();
  const scope = scopeFor(key);
  const collection = cloudCollection(key);

  current.forEach((value, id) => {
    const h = hash(JSON.stringify(value));
    nextHashes[id] = h;
    if (previous[id] !== h) {
      rows.push({
        business_id: account!.businessId,
        scope,
        collection,
        record_id: id,
        data: value,
        deleted: false,
        updated_by: device,
      });
    }
  });

  Object.keys(previous).forEach((id) => {
    if (!current.has(id)) {
      rows.push({
        business_id: account!.businessId,
        scope,
        collection,
        record_id: id,
        data: null,
        deleted: true,
        updated_by: device,
      });
    }
  });

  // Pedidos: una copia vieja no regresa un cobro ni una cancelación
  if (key === ORDERS_COLLECTION && rows.length > 0) await keepOrdersMoneyState(rows, scope, previous, nextHashes);
  // Inventario: lo que movió este equipo se suma a la nube (no la pisa)
  if (key === INVENTORY_KEY && rows.length > 0) await mergeInventoryWithCloud(rows, scope, previous, nextHashes);

  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const { data, error } = await getSupabase()
      .from("sync_records")
      .upsert(rows.slice(i, i + UPSERT_BATCH), { onConflict: "business_id,scope,collection,record_id" })
      .select("seq");
    if (error) throw new Error(friendlyError(error));
    // Lo que subió este equipo ya lo tiene: no se vuelve a bajar
    if (seenSeqs.size > 0) rememberSeqs(seenSeqs, ((data ?? []) as { seq: number | string }[]).map((r) => Number(r.seq)));
  }

  shadow[key] = nextHashes;
  if (Object.keys(nextHashes).length === 0) delete shadow[key];
  saveShadow();
  if (key === ORDERS_COLLECTION) pruneArchivedOrders();
  if (key === INVENTORY_KEY) refreshInventoryBase();
}

// ------------------------------------------------------------ inventario: sumar, no pisar

const INVENTORY_KEY = "bpos_inventory";
/** Cada artículo como estaba la última vez que se sincronizó (para saber qué movió este equipo) */
const INVENTORY_BASE_KEY = "bpos_sync_inventory_base";

/** Guarda como base los artículos que están igual que en la nube (los que este equipo no ha movido) */
function refreshInventoryBase() {
  const parsed = parseValue(rawGet(INVENTORY_KEY));
  if (parsed.mode !== "records") return;
  const keyShadow = shadow[INVENTORY_KEY] ?? {};
  const base = readJson<Record<string, unknown>>(INVENTORY_BASE_KEY, {});
  const next: Record<string, unknown> = {};
  parsed.list.forEach((item, i) => {
    const id = parsed.ids[i];
    if (keyShadow[id] && keyShadow[id] === hash(JSON.stringify(item))) next[id] = item;
    else if (base[id]) next[id] = base[id]; // movido aquí y sin subir: se queda la base de antes
  });
  safeSet(INVENTORY_BASE_KEY, JSON.stringify(next));
}

async function mergeInventoryWithCloud(rows: Obj[], scope: string, previous: Record<string, string>, nextHashes: Record<string, string>) {
  const ids = rows.filter((row) => !row.deleted).map((row) => String(row.record_id));
  const cloud = new Map<string, Obj>();
  for (let i = 0; i < ids.length; i += UPSERT_BATCH) {
    const { data, error } = await getSupabase()
      .from("sync_records")
      .select("record_id, data, deleted")
      .eq("business_id", account!.businessId)
      .eq("scope", scope)
      .eq("collection", cloudCollection(INVENTORY_KEY))
      .in("record_id", ids.slice(i, i + UPSERT_BATCH));
    if (error) throw new Error(friendlyError(error));
    (data ?? []).forEach((row) => row.data && !row.deleted && cloud.set(String(row.record_id), row.data as Obj));
  }
  const base = readJson<Record<string, Obj>>(INVENTORY_BASE_KEY, {});
  const fixed = new Map<string, [string, Obj]>();
  rows.forEach((row) => {
    const id = String(row.record_id);
    const remote = cloud.get(id);
    if (!remote || row.deleted) return;
    if (hash(JSON.stringify(remote)) === previous[id]) return; // nadie más lo cambió
    const merged = mergeInventoryItem(base[id], row.data as Obj, remote);
    if (merged === row.data) return;
    fixed.set(id, [hash(JSON.stringify(row.data)), merged]);
    row.data = merged;
    nextHashes[id] = hash(JSON.stringify(merged));
  });
  if (fixed.size === 0) return;
  // Este equipo también se queda con lo juntado (si no movió el artículo mientras tanto)
  const parsed = parseValue(rawGet(INVENTORY_KEY));
  if (parsed.mode !== "records") return;
  const list = parsed.list.map((item, i) => {
    const fix = fixed.get(parsed.ids[i]);
    return fix && hash(JSON.stringify(item)) === fix[0] ? fix[1] : item;
  });
  rawSet(INVENTORY_KEY, JSON.stringify(list));
  notifyApp([INVENTORY_KEY]);
}

/** Sube todo lo pendiente */
export function flush(): Promise<void> {
  return enqueue(async () => {
    if (!account || dirty.size === 0) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setStatus({ state: "offline", message: "Sin internet. Los cambios se subirán al volver la conexión." });
      return;
    }
    setStatus({ state: "syncing" });
    try {
      for (const key of [...dirty]) {
        await pushKey(key);
        dirty.delete(key);
        saveDirty();
      }
      setStatus({ state: "ok", lastSyncAt: new Date().toISOString(), message: undefined });
    } catch (error) {
      setStatus({ state: "error", message: error instanceof Error ? error.message : "Error al subir cambios." });
    }
  });
}

// ------------------------------------------------------------ bajar

function applyRows(rows: Row[]) {
  const byKey = new Map<string, Row[]>();
  rows.forEach((row) => {
    const key = localKeyOf(row.collection);
    if (!key || !shouldSync(key)) return;
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  });

  const changedKeys: string[] = [];

  byKey.forEach((changes, key) => {
    changes.sort((a, b) => a.seq - b.seq);
    const keyShadow = { ...(shadow[key] ?? {}) };
    const before = rawGet(key);

    // Listas renglón por renglón (kardex…)
    if (isRowKey(key)) {
      delete keyShadow[DOC_ID];
      const next = applyRowChanges(
        key,
        rowListOf(before),
        changes.map((c) => ({ record_id: c.record_id, data: c.data, deleted: c.deleted, hash: c.deleted ? undefined : hash(JSON.stringify(c.data)) })),
        keyShadow
      );
      shadow[key] = keyShadow;
      if (Object.keys(keyShadow).length === 0) delete shadow[key];
      const after = JSON.stringify(next);
      if (after !== (before ?? "[]")) {
        rawSet(key, after);
        changedKeys.push(key);
      }
      return;
    }

    const parsed = parseValue(before);
    let list: unknown[] = parsed.mode === "records" ? [...parsed.list] : [];
    let doc: { present: boolean; value: unknown } =
      parsed.mode === "doc" ? { present: true, value: parsed.value } : { present: false, value: null };
    let mode: "records" | "doc" | "missing" = parsed.mode;

    const cutoff = localOrdersCutoff();
    for (const change of changes) {
      // Ventas viejas que no están en la caja se quedan solo en la nube
      if (
        key === ORDERS_COLLECTION &&
        !change.deleted &&
        isArchivedOrder(change.data, cutoff) &&
        !list.some((item) => String((item as { id?: unknown }).id) === change.record_id)
      ) {
        continue;
      }
      const remoteHash = change.deleted ? undefined : hash(JSON.stringify(change.data));
      if (remoteHash && keyShadow[change.record_id] === remoteHash) continue; // ya lo tengo (eco)

      if (change.record_id === DOC_ID) {
        mode = "doc";
        list = [];
        Object.keys(keyShadow).forEach((id) => id !== DOC_ID && delete keyShadow[id]);
        if (change.deleted) {
          doc = { present: false, value: null };
          delete keyShadow[DOC_ID];
        } else {
          doc = { present: true, value: change.data };
          keyShadow[DOC_ID] = remoteHash!;
        }
        continue;
      }

      if (mode === "doc") {
        // cambia de documento a lista
        mode = "records";
        doc = { present: false, value: null };
        delete keyShadow[DOC_ID];
      }
      mode = "records";

      const index = list.findIndex(
        (item) => String((item as { id?: unknown }).id) === change.record_id
      );
      if (change.deleted) {
        if (index >= 0) list.splice(index, 1);
        delete keyShadow[change.record_id];
      } else {
        if (index >= 0) list[index] = change.data;
        else insertOrdered(list, change.data);
        keyShadow[change.record_id] = remoteHash!;
      }
    }

    let after: string | null;
    if (mode === "doc") after = doc.present ? JSON.stringify(doc.value) : null;
    else if (mode === "records") after = JSON.stringify(list);
    else after = before;

    // Si la lista quedó vacía y en la nube todo está borrado, se quita la llave
    if (mode === "records" && list.length === 0 && Object.keys(keyShadow).length === 0 && before === null) {
      after = null;
    }

    shadow[key] = keyShadow;
    if (Object.keys(keyShadow).length === 0) delete shadow[key];

    if (after !== before) {
      if (after === null) rawRemove(key);
      else rawSet(key, after);
      changedKeys.push(key);
    }
  });

  saveShadow();
  if (byKey.has(INVENTORY_KEY)) refreshInventoryBase();
  if (changedKeys.length > 0) notifyApp(changedKeys);
}

/**
 * Lo que los equipos no bajan: el kardex viejo (se queda en la nube) y los
 * documentos completos que siguen subiendo los equipos sin actualizar (los
 * actualizados usan "rows:<llave>", ver row-keys.ts).
 */
const NOT_DOWNLOADED = `(${[KARDEX_ARCHIVE_COLLECTION, ...LEGACY_DOC_COLLECTIONS].map((c) => `"${c}"`).join(",")})`;

/** Números de cambio vistos hace poco (la revisión hacia atrás no vuelve a bajar su contenido) */
const seenSeqs = new Set<number>();

async function fetchSince(since: number): Promise<Row[]> {
  const all: Row[] = [];
  let cursor = since;
  for (;;) {
    const { data, error } = await getSupabase()
      .from("sync_records")
      .select("collection, record_id, data, deleted, seq")
      .eq("business_id", account!.businessId)
      .in("scope", [account!.branchId, "business"])
      .not("collection", "in", NOT_DOWNLOADED)
      .gt("seq", cursor)
      .order("seq", { ascending: true })
      .limit(PAGE_SIZE);
    if (error) throw new Error(friendlyError(error));
    const rows = (data ?? []) as Row[];
    all.push(...rows.map((r) => ({ ...r, seq: Number(r.seq) })));
    if (rows.length < PAGE_SIZE) break;
    cursor = Number(rows[rows.length - 1].seq);
  }
  return all;
}

/** Solo los números de cambio desde un punto (casi no pesa) */
async function fetchSeqsAfter(from: number): Promise<number[]> {
  const all: number[] = [];
  let cursor = from;
  for (;;) {
    const { data, error } = await getSupabase()
      .from("sync_records")
      .select("seq")
      .eq("business_id", account!.businessId)
      .in("scope", [account!.branchId, "business"])
      .not("collection", "in", NOT_DOWNLOADED)
      .gt("seq", cursor)
      .order("seq", { ascending: true })
      .limit(PAGE_SIZE);
    if (error) throw new Error(friendlyError(error));
    const seqs = ((data ?? []) as { seq: number | string }[]).map((r) => Number(r.seq));
    all.push(...seqs);
    if (seqs.length < PAGE_SIZE) break;
    cursor = seqs[seqs.length - 1];
  }
  return all;
}

/** El contenido de cambios puntuales */
async function fetchBySeqs(seqs: number[]): Promise<Row[]> {
  const all: Row[] = [];
  for (let i = 0; i < seqs.length; i += UPSERT_BATCH) {
    const { data, error } = await getSupabase()
      .from("sync_records")
      .select("collection, record_id, data, deleted, seq")
      .eq("business_id", account!.businessId)
      .in("scope", [account!.branchId, "business"])
      .in("seq", seqs.slice(i, i + UPSERT_BATCH));
    if (error) throw new Error(friendlyError(error));
    all.push(...((data ?? []) as Row[]).map((r) => ({ ...r, seq: Number(r.seq) })));
  }
  return all;
}

/**
 * Cambios por bajar. Primero se piden solo los números de cambio (desde un
 * poco antes del último visto, por si alguno llegó fuera de orden) y el
 * contenido solo de los que este equipo no ha visto: ni la revisión hacia
 * atrás ni los cambios que subió este mismo equipo se vuelven a bajar
 * (antes se bajaban completos en cada revisión; con el kardex, 1-2 MB cada vez).
 */
async function fetchChanges(lastSeq: number, overlap: number): Promise<{ rows: Row[]; seqs: number[] }> {
  const from = Math.max(0, lastSeq - overlap);
  // Recién abierto, sin historial de lo visto: se baja completo una vez
  if (seenSeqs.size === 0) {
    const rows = await fetchSince(from);
    return { rows, seqs: rows.map((r) => r.seq) };
  }
  const seqs = await fetchSeqsAfter(from);
  const missing = unseenSeqs(seqs, seenSeqs);
  return { rows: missing.length ? await fetchBySeqs(missing) : [], seqs };
}

/** Baja los cambios de los demás dispositivos */
export function pull(): Promise<void> {
  return enqueue(async () => {
    if (!account || !meta) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setStatus({ state: "offline", message: "Sin internet. Trabajando con los datos de este dispositivo." });
      return;
    }
    try {
      // primero lo propio, para no pisar cambios locales sin subir
      for (const key of [...dirty]) {
        await pushKey(key);
        dirty.delete(key);
        saveDirty();
      }
      const wide = Date.now() - lastWidePull > WIDE_EVERY_MS;
      if (wide) lastWidePull = Date.now();
      const { rows, seqs } = await fetchChanges(meta.lastSeq, wide ? SEQ_OVERLAP_WIDE : SEQ_OVERLAP);
      if (rows.length > 0) applyRows(rows);
      const top = seqs.reduce((max, s) => Math.max(max, s), meta.lastSeq);
      if (top !== meta.lastSeq) {
        meta.lastSeq = top;
        saveMeta();
      }
      // Todo lo que hay hasta aquí ya se vio
      rememberSeqs(seenSeqs, seqs);
      if (seenSeqs.size === 0) seenSeqs.add(meta.lastSeq);
      setStatus({ state: "ok", lastSyncAt: new Date().toISOString(), message: undefined });
    } catch (error) {
      setStatus({ state: "error", message: error instanceof Error ? error.message : "Error al sincronizar." });
    }
  });
}

function schedulePull(delay = 300) {
  if (pullTimer) clearTimeout(pullTimer);
  pullTimer = setTimeout(() => void pull(), delay);
}

// ------------------------------------------------------------ arranque

export type InitialSituation = "ready" | "upload-local" | "download-cloud" | "choose";

function localSyncKeys() {
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (shouldSync(key)) keys.push(key);
  }
  return keys;
}

/** ¿Este navegador tiene datos de un negocio? (ventas, productos o inventario) */
export function hasLocalBusinessData() {
  return ["bpos_orders", "bpos_products", "bpos_inventory", "bpos_shift_history"].some((key) => {
    const raw = window.localStorage.getItem(key);
    return raw !== null && raw !== "[]" && raw !== "null";
  });
}

async function cloudHasData(acc: ReadyAccount) {
  const { count, error } = await getSupabase()
    .from("sync_records")
    .select("record_id", { count: "exact", head: true })
    .eq("business_id", acc.businessId)
    .in("scope", [acc.branchId, "business"]);
  if (error) throw new Error(friendlyError(error));
  return (count ?? 0) > 0;
}

/**
 * Qué hacer la primera vez que este dispositivo se conecta a esta sucursal.
 * "ready" = ya estaba sincronizado antes.
 */
export async function detectInitialSituation(acc: ReadyAccount): Promise<InitialSituation> {
  bindRawStorage();
  const saved = readJson<SyncMeta | null>(META_KEY, null);
  if (saved && saved.businessId === acc.businessId && saved.branchId === acc.branchId) return "ready";

  const cloud = await cloudHasData(acc);
  const local = hasLocalBusinessData();
  if (!cloud) return "upload-local";
  if (!local) return "download-cloud";
  return "choose";
}

/**
 * Primera sincronización del dispositivo.
 *  - "upload-local": sube todo lo de este navegador (primer dispositivo)
 *  - "download-cloud": reemplaza lo local con lo de la nube
 *  - "merge": baja la nube y luego sube lo que solo existe aquí
 */
export async function initialSync(
  acc: ReadyAccount,
  strategy: "upload-local" | "download-cloud" | "merge",
  onProgress?: (text: string) => void
) {
  bindRawStorage();
  account = acc;
  shadow = {};
  dirty = new Set();
  meta = { businessId: acc.businessId, branchId: acc.branchId, lastSeq: 0 };

  if (strategy === "download-cloud") {
    localSyncKeys().forEach((key) => rawRemove(key));
  }

  // El primer dispositivo (el que sube sus datos) queda como caja principal
  if (rawGet("bpos_device_role") === null) {
    rawSet("bpos_device_role", strategy === "download-cloud" ? "secondary" : "primary");
  }

  if (strategy !== "upload-local") {
    onProgress?.("Descargando datos de la nube...");
    const rows = await fetchSince(0);
    applyRows(rows);
    meta.lastSeq = rows.reduce((max, r) => Math.max(max, r.seq), 0);
  }

  if (strategy !== "download-cloud") {
    const keys = localSyncKeys();
    let done = 0;
    for (const key of keys) {
      done += 1;
      onProgress?.(`Subiendo datos de esta computadora (${done} de ${keys.length})...`);
      await pushKey(key);
    }
    // lo que acabamos de subir ya está en la nube: avanza el cursor
    const rows = await fetchSince(meta.lastSeq);
    applyRows(rows);
    meta.lastSeq = rows.reduce((max, r) => Math.max(max, r.seq), meta.lastSeq);
  }

  saveShadow();
  saveDirty();
  saveMeta();
}

/**
 * Activa la sincronización continua. Debe llamarse antes de que se
 * muestren las pantallas, para no perder ninguna escritura.
 */
export function startSync(acc: ReadyAccount) {
  const { proto, originalSet, originalRemove } = bindRawStorage();
  // Primero liberar espacio: las ventas viejas traían copias completas de cada producto
  const compacted = compactOrders();
  account = acc;
  meta = readJson<SyncMeta | null>(META_KEY, null) ?? {
    businessId: acc.businessId,
    branchId: acc.branchId,
    lastSeq: 0,
  };
  shadow = readJson<Shadow>(SHADOW_KEY, {});
  dirty = new Set(readJson<string[]>(DIRTY_KEY, []));
  // Listas que pasaron de documento completo a renglón por renglón (row-keys.ts):
  // la caja principal sube sus renglones una vez; los demás equipos los reciben.
  Object.keys(ROW_KEYS).forEach((key) => {
    const keyShadow = shadow[key];
    if (!keyShadow || !(DOC_ID in keyShadow)) return;
    delete shadow[key];
    saveShadow();
    if (isPrimaryDevice() && rawGet(key) !== null) {
      dirty.add(key);
      saveDirty();
    }
  });
  if (compacted) {
    dirty.add(ORDERS_COLLECTION);
    saveDirty();
  }
  pruneArchivedOrders();
  refreshInventoryBase();

  if (started) return;
  started = true;

  const w = window as unknown as { __bposRawSet?: Storage["setItem"]; __bposRawRemove?: Storage["removeItem"] };
  w.__bposRawSet = originalSet;
  w.__bposRawRemove = originalRemove;

  proto.setItem = function setItem(this: Storage, key: string, value: string) {
    const isLocal = this === window.localStorage;
    const next = isLocal && key === ORDERS_COLLECTION ? slimOrdersText(value) : value;
    try {
      originalSet.call(this, key, next);
    } catch (e) {
      // Memoria llena. Primero se recortan la auditoría (su copia completa está en la nube) y los avisos resueltos
      if (!isLocal || !isQuotaError(e)) throw e;
      freeDisposableSpace(this, originalSet, key);
      const value2 = DISPOSABLE_KEYS.includes(key) ? trimmedDisposable(key, next) : next;
      try {
        originalSet.call(this, key, value2);
      } catch (e2) {
        // Sigue llena: se suelta la copia guardada de "lo ya subido", pero NO la de la memoria.
        // Antes se olvidaba también y B-POS volvía a subir TODO (y todos los equipos lo bajaban):
        // eso disparaba el tráfico de Supabase. Se vuelve a guardar en cuanto haya espacio.
        if (!isQuotaError(e2)) throw e2;
        originalRemove.call(this, SHADOW_KEY);
        originalSet.call(this, key, value2);
      }
    }
    if (this === window.localStorage && shouldSync(key)) markDirty(key);
  };
  proto.removeItem = function removeItem(this: Storage, key: string) {
    originalRemove.call(this, key);
    if (this === window.localStorage && shouldSync(key)) markDirty(key);
  };

  // Tiempo real: se escucha sync_heads (una fila por negocio con el último número de cambio,
  // 0042). Antes se escuchaba sync_records y cada aviso traía el registro completo
  // (el kardex entero en cada venta) a cada equipo.
  const supabase = getSupabase();
  const channel = supabase.channel(`sync-${acc.businessId}-${getDeviceId()}`);
  channel.on(
    "postgres_changes",
    { event: "*", schema: "public", table: "sync_heads", filter: `business_id=eq.${acc.businessId}` },
    (payload: { new?: { seq?: number | string } }) => {
      const seq = Number(payload?.new?.seq);
      if (meta && Number.isFinite(seq) && seq <= meta.lastSeq) return; // ya lo tengo (mi propio cambio)
      schedulePull();
    }
  );
  channel.subscribe((status: string) => {
    liveStatus = status;
    // Al volver el tiempo real, de una vez lo que se pudo haber perdido
    if (status === "SUBSCRIBED") schedulePull(100);
  });

  // Respaldo: revisión periódica. Con tiempo real basta cada minuto; sin él (se cayó la
  // conexión o la nube la rechazó) cada 10 s para que pedidos y mensajes no tarden.
  // Si la pantalla está escondida se sigue revisando, más despacio (el navegador lo frena).
  let lastPoll = Date.now();
  setInterval(() => {
    const visible = document.visibilityState === "visible";
    const every = pollEveryMs(liveStatus === "SUBSCRIBED", visible);
    if (Date.now() - lastPoll < every) return;
    lastPoll = Date.now();
    void pull();
  }, 5000);
  // Al cambiar de mes, el mes antepasado se va a la nube
  setInterval(() => void enqueue(async () => pruneArchivedOrders()), 60 * 60 * 1000);
  // El kardex viejo se va a la nube (al abrir y cada hora)
  void enqueue(() => archiveOldKardex());
  setInterval(() => void enqueue(() => archiveOldKardex()), 60 * 60 * 1000);
  window.addEventListener("online", () => {
    void flush();
    schedulePull(100);
  });
  window.addEventListener("offline", () =>
    setStatus({ state: "offline", message: "Sin internet. Los cambios se subirán al volver la conexión." })
  );
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") schedulePull(100);
    else void flush();
  });

  if (dirty.size > 0) void flush();
  schedulePull(50);
}

// ------------------------------------------------------------ dispositivo principal

const ROLE_KEY = "bpos_device_role";

/**
 * Solo un dispositivo por sucursal (la caja principal) descuenta el
 * inventario de las ventas en segundo plano, para que no se descuente
 * dos veces cuando hay varias pantallas abiertas (cocina, celular...).
 */
export function isPrimaryDevice() {
  if (typeof window === "undefined") return false;
  const role = window.localStorage.getItem(ROLE_KEY);
  return role === null || role === "primary";
}

export function setPrimaryDevice(primary: boolean) {
  bindRawStorage();
  rawSet(ROLE_KEY, primary ? "primary" : "secondary");
}

/** Olvida la sincronización de este dispositivo (al desconectarlo) */
/**
 * Borra de este navegador los datos de negocio (ventas, productos, usuarios,
 * configuración...) y deja los del dispositivo. Al dar de alta un negocio
 * nuevo, para que no herede nada de otro negocio abierto antes aquí.
 */
export function clearLocalBusinessData() {
  bindRawStorage();
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (shouldSync(key)) keys.push(key);
  }
  keys.forEach((key) => rawRemove(key));
}

export function resetDeviceSync() {
  bindRawStorage();
  rawRemove(META_KEY);
  rawRemove(SHADOW_KEY);
  rawRemove(DIRTY_KEY);
}
