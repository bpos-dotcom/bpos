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
import type { ReadyAccount } from "@/lib/cloud/account";
import { friendlyError, getSupabase } from "@/lib/supabase/client";

// ------------------------------------------------------------ configuración

/** Llaves que pertenecen a este dispositivo y nunca se sincronizan */
const DEVICE_LOCAL_KEYS = new Set([
  "bpos_current_user",
  "bpos_device_id",
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
  "bpos_theme",
]);

/** Llaves compartidas por todas las sucursales del negocio */
const BUSINESS_KEYS = new Set([
  "bpos_products",
  "bpos_recipes",
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
  "bpos_coupons",
  "bpos_customers",
  "bpos_loyalty",
]);

/** Eventos que ya escuchan las pantallas de B-POS */
const APP_EVENTS = [
  "bpos:audit-updated",
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
/** Se vuelve a leer un poco hacia atrás por si un cambio llegó fuera de orden */
const SEQ_OVERLAP = 200;

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
  rawSet = (k, v) => originalSet.call(storage, k, v);
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

function saveShadow() {
  rawSet(SHADOW_KEY, JSON.stringify(shadow));
}

function saveMeta() {
  if (meta) rawSet(META_KEY, JSON.stringify(meta));
}

function saveDirty() {
  rawSet(DIRTY_KEY, JSON.stringify([...dirty]));
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
function toEntries(parsed: Parsed): Map<string, unknown> {
  const map = new Map<string, unknown>();
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
        new StorageEvent("storage", { key, newValue: rawGet(key), storageArea: window.localStorage })
      );
    } catch {
      window.dispatchEvent(new Event("storage"));
    }
  });
  APP_EVENTS.forEach((name) => window.dispatchEvent(new Event(name)));
}

// ------------------------------------------------------------ subir

function markDirty(key: string) {
  dirty.add(key);
  saveDirty();
  setStatus({});
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void flush(), 500);
}

async function pushKey(key: string) {
  if (!account) return;
  const current = toEntries(parseValue(rawGet(key)));
  const previous = shadow[key] ?? {};
  const nextHashes: Record<string, string> = {};
  const rows: Record<string, unknown>[] = [];
  const device = getDeviceId();
  const scope = scopeFor(key);

  current.forEach((value, id) => {
    const h = hash(JSON.stringify(value));
    nextHashes[id] = h;
    if (previous[id] !== h) {
      rows.push({
        business_id: account!.businessId,
        scope,
        collection: key,
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
        collection: key,
        record_id: id,
        data: null,
        deleted: true,
        updated_by: device,
      });
    }
  });

  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const { error } = await getSupabase()
      .from("sync_records")
      .upsert(rows.slice(i, i + UPSERT_BATCH), { onConflict: "business_id,scope,collection,record_id" });
    if (error) throw new Error(friendlyError(error));
  }

  shadow[key] = nextHashes;
  if (Object.keys(nextHashes).length === 0) delete shadow[key];
  saveShadow();
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
    if (!shouldSync(row.collection)) return;
    const list = byKey.get(row.collection) ?? [];
    list.push(row);
    byKey.set(row.collection, list);
  });

  const changedKeys: string[] = [];

  byKey.forEach((changes, key) => {
    changes.sort((a, b) => a.seq - b.seq);
    const keyShadow = { ...(shadow[key] ?? {}) };
    const before = rawGet(key);
    const parsed = parseValue(before);
    let list: unknown[] = parsed.mode === "records" ? [...parsed.list] : [];
    let doc: { present: boolean; value: unknown } =
      parsed.mode === "doc" ? { present: true, value: parsed.value } : { present: false, value: null };
    let mode: "records" | "doc" | "missing" = parsed.mode;

    for (const change of changes) {
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
  if (changedKeys.length > 0) notifyApp(changedKeys);
}

async function fetchSince(since: number): Promise<Row[]> {
  const all: Row[] = [];
  let cursor = since;
  for (;;) {
    const { data, error } = await getSupabase()
      .from("sync_records")
      .select("collection, record_id, data, deleted, seq")
      .eq("business_id", account!.businessId)
      .in("scope", [account!.branchId, "business"])
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
      const rows = await fetchSince(Math.max(0, meta.lastSeq - SEQ_OVERLAP));
      if (rows.length > 0) {
        applyRows(rows);
        meta.lastSeq = Math.max(meta.lastSeq, ...rows.map((r) => r.seq));
        saveMeta();
      }
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
  account = acc;
  meta = readJson<SyncMeta | null>(META_KEY, null) ?? {
    businessId: acc.businessId,
    branchId: acc.branchId,
    lastSeq: 0,
  };
  shadow = readJson<Shadow>(SHADOW_KEY, {});
  dirty = new Set(readJson<string[]>(DIRTY_KEY, []));

  if (started) return;
  started = true;

  const w = window as unknown as { __bposRawSet?: Storage["setItem"]; __bposRawRemove?: Storage["removeItem"] };
  w.__bposRawSet = originalSet;
  w.__bposRawRemove = originalRemove;

  proto.setItem = function setItem(this: Storage, key: string, value: string) {
    originalSet.call(this, key, value);
    if (this === window.localStorage && shouldSync(key)) markDirty(key);
  };
  proto.removeItem = function removeItem(this: Storage, key: string) {
    originalRemove.call(this, key);
    if (this === window.localStorage && shouldSync(key)) markDirty(key);
  };

  // Tiempo real
  const supabase = getSupabase();
  const channel = supabase.channel(`sync-${acc.businessId}-${getDeviceId()}`);
  channel.on(
    "postgres_changes",
    { event: "*", schema: "public", table: "sync_records", filter: `business_id=eq.${acc.businessId}` },
    () => schedulePull()
  );
  channel.subscribe();

  // Respaldo: revisión periódica, al volver la conexión y al regresar a la pestaña
  setInterval(() => {
    if (document.visibilityState === "visible") void pull();
  }, 20000);
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
export function resetDeviceSync() {
  bindRawStorage();
  rawRemove(META_KEY);
  rawRemove(SHADOW_KEY);
  rawRemove(DIRTY_KEY);
}
