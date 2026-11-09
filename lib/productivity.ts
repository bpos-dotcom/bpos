"use client";
/**
 * Productividad: recordatorios, listas de tareas, mensajes del turno e
 * inventario ciego. El dueño los configura en la App del dueño →
 * Productividad; la caja principal los hace sonar (pip pip pip + voz) en
 * cualquier pantalla y los empleados los atienden en /productividad.
 *
 * Todo vive en llaves bpos_* de localStorage, así que se sincroniza solo
 * entre la caja y el celular del dueño (por sucursal).
 */
import { addAuditEvent } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { adjustInventory, getInventory } from "@/lib/inventory";
import { getLatestIngredientCost } from "@/lib/purchases";

export const TASKS_KEY = "bpos_productivity_tasks";
export const LOG_KEY = "bpos_productivity_log";
export const MESSAGES_KEY = "bpos_shift_messages";
export const SETTINGS_KEY = "bpos_productivity_settings";
export const BLIND_KEY = "bpos_blind_counts";
export const PRODUCTIVITY_EVENT = "bpos:productivity-updated";

/** "HH:MM" (24 h) */
export type Clock = string;

export type Schedule =
  | { mode: "una"; date: string; time: Clock } // una sola vez (fecha YYYY-MM-DD)
  | { mode: "dias"; days: number[]; times: Clock[] } // ciertos días (0 = domingo) a ciertas horas
  | { mode: "cada"; days: number[]; every: number; from: Clock; to: Clock }; // cada N minutos dentro de un horario

export type ProductivityTask = {
  id: string;
  /** recordatorio: un aviso; lista: varias tareas con palomita (apertura, cierre...) */
  kind: "recordatorio" | "lista";
  title: string;
  /** Lo que lee la voz (vacío = el título) */
  speech?: string;
  items?: string[];
  schedule: Schedule;
  /** Si no lo atienden, vuelve a sonar cada N minutos (0 = suena una vez) */
  repeatMinutes: number;
  /** Pide foto de evidencia para darlo por hecho */
  evidence: boolean;
  voice: boolean;
  /** Avisar al dueño cuando lo atiendan */
  notifyDone: boolean;
  /** Avisar al dueño si a los N minutos nadie lo atiende (0 = no) */
  ownerAfterMinutes: number;
  active: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
};

export type TaskRecord = {
  id: string; // `${taskId}|${slot}`
  taskId: string;
  title: string;
  kind: ProductivityTask["kind"];
  slot: string;
  status: "en curso" | "hecho";
  checked?: string[];
  doneAt?: string;
  doneBy?: string;
  photo?: string;
};

export type ShiftMessage = {
  id: string;
  text: string;
  createdAt: string;
  from: string;
  voice: boolean;
  repeatMinutes: number;
  acks: { name: string; at: string }[];
};

export type BlindSettings = {
  enabled: boolean;
  days: number[];
  time: Clock;
  speech: string;
  repeatMinutes: number;
  /** todo: todos los insumos y empaques; elegidos: solo ingredientIds */
  scope: "todo" | "elegidos";
  ingredientIds: number[];
};

export type ProductivitySettings = {
  /** Correo del reporte del inventario ciego (vacío = el del corte o el del negocio) */
  email: string;
  /** Mensajes del turno: vuelven a sonar cada N minutos hasta que alguien dé Enterado */
  messageRepeatMinutes: number;
  blind: BlindSettings;
};

export type BlindLine = {
  ingredientId: number;
  name: string;
  unit: string;
  category?: string;
  counted: number | null;
  /** Lo que decía el sistema cuando capturaron esa cantidad (no se les muestra) */
  expected?: number;
  unitCost?: number;
  at?: string;
};

export type BlindCount = {
  id: string;
  /** La hora que tocaba (o cuando el dueño lo pidió) */
  slot: string;
  /** pendiente: lo pidió el dueño y nadie lo ha empezado */
  status: "pendiente" | "en curso" | "enviado" | "ajustado" | "revisado";
  requestedBy?: string;
  startedAt?: string;
  startedBy?: string;
  lines: BlindLine[];
  submittedAt?: string;
  submittedBy?: string;
  reviewedAt?: string;
  reviewedBy?: string;
};

export const DEFAULT_SETTINGS: ProductivitySettings = {
  email: "",
  messageRepeatMinutes: 5,
  blind: { enabled: false, days: [1, 4], time: "11:00", speech: "Toca inventario ciego. Entren a Productividad y denle Empezar.", repeatMinutes: 10, scope: "todo", ingredientIds: [] },
};

export const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
export const REPEAT_OPTIONS = [0, 5, 10, 15, 20, 30, 45, 60];

// ------------------------------------------------------------ lectura y escritura

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : fallback;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new Event(PRODUCTIVITY_EVENT));
}

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const who = () => getCurrentUser().name || "Usuario";

export const getTasks = () => read<ProductivityTask[]>(TASKS_KEY, []).filter((t) => t && t.id);
export const getLog = () => read<TaskRecord[]>(LOG_KEY, []).filter((r) => r && r.id);
export const getMessages = () => read<ShiftMessage[]>(MESSAGES_KEY, []).filter((m) => m && m.id);
export const getBlindCounts = () => read<BlindCount[]>(BLIND_KEY, []).filter((c) => c && c.id);

export function getProductivitySettings(): ProductivitySettings {
  const raw = read<Partial<ProductivitySettings>>(SETTINGS_KEY, {});
  return { ...DEFAULT_SETTINGS, ...raw, blind: { ...DEFAULT_SETTINGS.blind, ...(raw.blind || {}) } };
}

export function saveProductivitySettings(patch: Partial<ProductivitySettings>) {
  const next = { ...getProductivitySettings(), ...patch };
  write(SETTINGS_KEY, next);
  return next;
}

export function saveTask(task: Omit<ProductivityTask, "id" | "createdAt" | "createdBy"> & { id?: string }) {
  const list = getTasks();
  const existing = task.id ? list.find((t) => t.id === task.id) : undefined;
  const saved: ProductivityTask = existing
    ? { ...existing, ...task, id: existing.id, updatedAt: new Date().toISOString() }
    : { ...task, id: newId("tarea"), createdAt: new Date().toISOString(), createdBy: who() };
  write(TASKS_KEY, existing ? list.map((t) => (t.id === saved.id ? saved : t)) : [...list, saved]);
  return saved;
}

export function deleteTask(id: string) {
  write(TASKS_KEY, getTasks().filter((t) => t.id !== id));
}

// ------------------------------------------------------------ horarios

const pad = (n: number) => String(n).padStart(2, "0");
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const minutesOf = (clock: Clock) => {
  const [h, m] = String(clock || "").split(":").map(Number);
  return Number.isFinite(h) ? h * 60 + (Number.isFinite(m) ? m : 0) : NaN;
};
const at = (day: Date, minutes: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60);

/** Las horas que ya tocaron hoy (las que siguen pendientes las decide pendingTasks). */
export function dueSlots(task: ProductivityTask, now = new Date()): Date[] {
  const s = task.schedule;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (s.mode === "una") {
    const [y, mo, d] = s.date.split("-").map(Number);
    const when = new Date(y, (mo || 1) - 1, d || 1, Math.floor(minutesOf(s.time) / 60) || 0, minutesOf(s.time) % 60 || 0);
    // Una sola vez: sigue pendiente hasta que la atiendan (máximo una semana)
    return when <= now && now.getTime() - when.getTime() < 7 * 86_400_000 ? [when] : [];
  }
  if (!s.days.includes(now.getDay())) return [];
  if (s.mode === "dias") {
    return s.times
      .map(minutesOf)
      .filter((m) => Number.isFinite(m))
      .sort((a, b) => a - b)
      .map((m) => at(today, m))
      .filter((d) => d <= now);
  }
  // Cada N minutos: solo cuenta la vuelta más reciente (las anteriores ya pasaron)
  const from = minutesOf(s.from);
  const to = minutesOf(s.to);
  const every = Math.max(5, Number(s.every) || 60);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (!Number.isFinite(from) || !Number.isFinite(to) || nowMin < from) return [];
  const last = Math.min(to, from + Math.floor((nowMin - from) / every) * every);
  return [at(today, last)];
}

export function scheduleText(s: Schedule) {
  const days = (list: number[]) => (list.length === 7 ? "Todos los días" : list.length ? list.slice().sort().map((d) => DAY_NAMES[d]).join(", ") : "Ningún día");
  if (s.mode === "una") return `Una vez: ${s.date.split("-").reverse().join("/")} a las ${s.time}`;
  if (s.mode === "dias") return `${days(s.days)} · ${s.times.slice().sort().join(", ") || "sin hora"}`;
  return `${days(s.days)} · cada ${s.every} min de ${s.from} a ${s.to}`;
}

export const repeatText = (minutes: number) => (minutes > 0 ? `Suena cada ${minutes} min hasta que lo atiendan` : "Suena una vez");

// ------------------------------------------------------------ pendientes

export type PendingTask = { task: ProductivityTask; slot: string; key: string; record?: TaskRecord };

const recordId = (taskId: string, slot: string) => `${taskId}|${slot}`;

export function pendingTasks(now = new Date()): PendingTask[] {
  const log = new Map(getLog().map((r) => [r.id, r]));
  const out: PendingTask[] = [];
  for (const task of getTasks()) {
    if (!task.active) continue;
    // Un recordatorio nuevo no cobra las horas que ya pasaron antes de crearlo (salvo "una vez")
    const since = task.schedule.mode === "una" ? 0 : Date.parse(task.createdAt) - 60_000;
    for (const when of dueSlots(task, now).filter((d) => d.getTime() >= since)) {
      const slot = when.toISOString();
      const key = recordId(task.id, slot);
      const record = log.get(key);
      if (record?.status !== "hecho") out.push({ task, slot, key, record });
    }
  }
  return out.sort((a, b) => a.slot.localeCompare(b.slot));
}

/** Atendidos de hoy (más recientes primero) */
export function doneToday(now = new Date()): TaskRecord[] {
  const today = dayKey(now);
  return getLog()
    .filter((r) => r.status === "hecho" && r.doneAt && dayKey(new Date(r.doneAt)) === today)
    .sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
}

function saveRecord(record: TaskRecord) {
  const list = getLog().filter((r) => r.id !== record.id);
  // Se guardan los últimos 60 días
  const cutoff = Date.now() - 60 * 86_400_000;
  write(LOG_KEY, [...list.filter((r) => Date.parse(r.slot) > cutoff), record]);
}

/** Palomita de una tarea de una lista (sin terminarla todavía) */
export function toggleListItem(p: PendingTask, item: string) {
  const checked = new Set(p.record?.checked || []);
  if (checked.has(item)) checked.delete(item);
  else checked.add(item);
  saveRecord({ id: p.key, taskId: p.task.id, title: p.task.title, kind: p.task.kind, slot: p.slot, status: "en curso", checked: [...checked] });
}

export function completeTask(p: PendingTask, photo?: string) {
  if (p.task.evidence && !photo) throw new Error("Este recordatorio necesita foto de evidencia.");
  const by = who();
  const record: TaskRecord = {
    id: p.key,
    taskId: p.task.id,
    title: p.task.title,
    kind: p.task.kind,
    slot: p.slot,
    status: "hecho",
    checked: p.task.kind === "lista" ? p.task.items || [] : undefined,
    doneAt: new Date().toISOString(),
    doneBy: by,
    ...(photo ? { photo } : {}),
  };
  saveRecord(record);
  if (p.task.notifyDone) {
    addAuditEvent({
      category: "Productividad",
      action: "task.done",
      description: `${by} atendió "${p.task.title}"${photo ? " (con foto)" : ""}`,
      userName: by,
      entityId: p.task.id,
      metadata: { photo: photo || null, slot: p.slot },
    });
  }
  return record;
}

// ------------------------------------------------------------ mensajes del turno

export function sendShiftMessage(text: string, opts: { voice: boolean; repeatMinutes: number }) {
  const message: ShiftMessage = { id: newId("msg"), text: text.trim(), createdAt: new Date().toISOString(), from: who(), voice: opts.voice, repeatMinutes: opts.repeatMinutes, acks: [] };
  const cutoff = Date.now() - 7 * 86_400_000;
  write(MESSAGES_KEY, [...getMessages().filter((m) => Date.parse(m.createdAt) > cutoff), message]);
  return message;
}

/** Mensajes de las últimas 24 horas (más nuevos primero) */
export function recentMessages(now = Date.now()) {
  return getMessages()
    .filter((m) => now - Date.parse(m.createdAt) < 86_400_000)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const unreadMessages = (now = Date.now()) => recentMessages(now).filter((m) => !m.acks.length);

export function ackMessage(id: string) {
  const name = who();
  write(
    MESSAGES_KEY,
    getMessages().map((m) => (m.id === id && !m.acks.some((a) => a.name === name) ? { ...m, acks: [...m.acks, { name, at: new Date().toISOString() }] } : m))
  );
}

export function deleteMessage(id: string) {
  write(MESSAGES_KEY, getMessages().filter((m) => m.id !== id));
}

// ------------------------------------------------------------ inventario ciego

/** Hora del inventario ciego de hoy si ya tocó, o null */
export function blindSlotToday(now = new Date()): string | null {
  const b = getProductivitySettings().blind;
  if (!b.enabled || !b.days.includes(now.getDay())) return null;
  const m = minutesOf(b.time);
  if (!Number.isFinite(m)) return null;
  const when = at(new Date(now.getFullYear(), now.getMonth(), now.getDate()), m);
  return when <= now ? when.toISOString() : null;
}

const CLOSED: BlindCount["status"][] = ["enviado", "ajustado", "revisado"];

/**
 * El inventario ciego que les toca ahora: uno empezado o pedido por el dueño,
 * o el de hoy si ya es la hora y nadie lo ha subido. null si no hay.
 */
export function pendingBlind(now = new Date()): { count?: BlindCount; slot: string } | null {
  const counts = getBlindCounts();
  const open = counts.filter((c) => c.status === "en curso" || c.status === "pendiente").sort((a, b) => b.slot.localeCompare(a.slot))[0];
  if (open) return { count: open, slot: open.slot };
  const slot = blindSlotToday(now);
  if (!slot) return null;
  const done = counts.some((c) => CLOSED.includes(c.status) && c.slot === slot);
  return done ? null : { slot };
}

function blindItems() {
  const b = getProductivitySettings().blind;
  const chosen = new Set(b.ingredientIds.map(Number));
  return getInventory()
    .filter((i) => b.scope === "todo" || chosen.has(Number(i.id)))
    .sort((x, y) => (x.category || "zzz").localeCompare(y.category || "zzz") || x.name.localeCompare(y.name));
}

function saveBlind(count: BlindCount) {
  const cutoff = Date.now() - 180 * 86_400_000;
  write(BLIND_KEY, [...getBlindCounts().filter((c) => c.id !== count.id && Date.parse(c.slot) > cutoff), count]);
  return count;
}

/** El dueño lo pide en este momento (fuera del horario) */
export function requestBlindNow() {
  if (getBlindCounts().some((c) => c.status === "pendiente" || c.status === "en curso")) throw new Error("Ya hay un inventario ciego pendiente o en curso.");
  return saveBlind({ id: newId("ciego"), slot: new Date().toISOString(), status: "pendiente", requestedBy: who(), lines: [] });
}

/** Empieza (o continúa) el inventario ciego que toca; regresa su id */
export function startBlind(): BlindCount {
  const pending = pendingBlind();
  if (!pending) throw new Error("No hay inventario ciego pendiente.");
  if (pending.count?.status === "en curso") return pending.count;
  const lines: BlindLine[] = blindItems().map((i) => ({ ingredientId: Number(i.id), name: i.name, unit: i.unit, category: i.category, counted: null }));
  if (!lines.length) throw new Error("No hay insumos para contar. El dueño debe elegirlos en la App del dueño → Productividad.");
  return saveBlind({
    ...(pending.count || { id: newId("ciego"), slot: pending.slot }),
    status: "en curso",
    startedAt: new Date().toISOString(),
    startedBy: who(),
    lines,
  });
}

/** Guarda lo que contaron de un insumo y lo que decía el sistema en ese momento */
export function setBlindLine(countId: string, ingredientId: number, counted: number | null) {
  const count = getBlindCounts().find((c) => c.id === countId);
  if (!count || count.status !== "en curso") return;
  const stock = getInventory().find((i) => Number(i.id) === ingredientId);
  saveBlind({
    ...count,
    lines: count.lines.map((l) =>
      l.ingredientId === ingredientId
        ? counted === null
          ? { ...l, counted: null, expected: undefined, at: undefined }
          : { ...l, counted, expected: Number(stock?.stock) || 0, unitCost: getLatestIngredientCost(ingredientId)?.unitCost || 0, at: new Date().toISOString() }
        : l
    ),
  });
}

export type BlindRow = BlindLine & { diff: number; money: number; state: "cuadra" | "falta" | "sobra" | "sin contar" };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function blindRows(count: BlindCount): BlindRow[] {
  return count.lines.map((l) => {
    if (l.counted === null || l.expected === undefined) return { ...l, diff: 0, money: 0, state: "sin contar" as const };
    const diff = round3(l.counted - l.expected);
    const state = Math.abs(diff) < 0.0005 ? "cuadra" : diff < 0 ? "falta" : "sobra";
    return { ...l, diff, money: Math.round(diff * (l.unitCost || 0) * 100) / 100, state };
  });
}

export function blindSummary(count: BlindCount) {
  const rows = blindRows(count);
  const of = (s: BlindRow["state"]) => rows.filter((r) => r.state === s);
  return {
    rows,
    cuadra: of("cuadra").length,
    falta: of("falta").length,
    sobra: of("sobra").length,
    sinContar: of("sin contar").length,
    faltante: Math.round(of("falta").reduce((s, r) => s - r.money, 0) * 100) / 100,
    sobrante: Math.round(of("sobra").reduce((s, r) => s + r.money, 0) * 100) / 100,
  };
}

export function submitBlind(countId: string) {
  const count = getBlindCounts().find((c) => c.id === countId);
  if (!count || count.status !== "en curso") throw new Error("Este inventario ya se subió.");
  const by = who();
  const saved = saveBlind({ ...count, status: "enviado", submittedAt: new Date().toISOString(), submittedBy: by });
  const s = blindSummary(saved);
  addAuditEvent({
    category: "Productividad",
    action: "blind.submitted",
    description: `${by} subió el inventario ciego: ${s.cuadra} cuadran, ${s.falta} con faltante${s.faltante ? ` ($${s.faltante.toFixed(2)})` : ""}, ${s.sobra} con sobrante${s.sinContar ? `, ${s.sinContar} sin contar` : ""}`,
    userName: by,
    entityId: saved.id,
    metadata: { faltante: s.faltante, sobrante: s.sobrante, falta: s.falta, sobra: s.sobra, cuadra: s.cuadra },
  });
  return saved;
}

/**
 * El dueño está de acuerdo con lo que contó el personal: cada insumo queda en
 * lo contado más lo que se movió desde que lo contaron (ventas, compras).
 */
export function adjustBlindToCounted(countId: string) {
  const count = getBlindCounts().find((c) => c.id === countId);
  if (!count || count.status !== "enviado") throw new Error("Este inventario ya se revisó.");
  const when = new Date(count.submittedAt || count.slot).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
  let changed = 0;
  for (const row of blindRows(count)) {
    if (row.state !== "falta" && row.state !== "sobra") continue;
    adjustInventory({
      ingredientId: row.ingredientId,
      quantity: Math.abs(row.diff),
      adjustmentType: row.diff > 0 ? "Ajuste positivo" : "Ajuste negativo",
      reason: `Inventario ciego del ${when}: contaron ${row.counted} ${row.unit} (${count.submittedBy || "personal"})`,
    });
    changed++;
  }
  saveBlind({ ...count, status: "ajustado", reviewedAt: new Date().toISOString(), reviewedBy: who() });
  addAuditEvent({ category: "Inventario", action: "blind.adjusted", description: `${who()} ajustó ${changed} insumo(s) a lo contado en el inventario ciego del ${when}`, userName: who(), entityId: count.id });
  return changed;
}

export function dismissBlind(countId: string) {
  const count = getBlindCounts().find((c) => c.id === countId);
  if (!count) return;
  saveBlind({ ...count, status: "revisado", reviewedAt: new Date().toISOString(), reviewedBy: who() });
}

export function cancelBlind(countId: string) {
  write(BLIND_KEY, getBlindCounts().filter((c) => c.id !== countId));
}
