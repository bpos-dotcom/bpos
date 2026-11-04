"use client";
/**
 * Checador de entrada y salida (bpos.com.mx/checador): cada empleado marca
 * con su PIN de B-POS. Los registros se guardan por sucursal
 * (bpos_timeclock, sincronizado) y se consultan en Configuración → Asistencia.
 */

export type PunchType = "entrada" | "salida";
export type Punch = { id: string; userId: number; userName: string; type: PunchType; at: string; note?: string; editedBy?: string };

export const TIMECLOCK_KEY = "bpos_timeclock";
export const TIMECLOCK_EVENT = "bpos:timeclock-updated";
/** Si alguien olvidó marcar la salida, la jornada se corta aquí (horas) */
export const MAX_SHIFT_HOURS = 16;

export function getPunches(): Punch[] {
  try {
    const list = JSON.parse(localStorage.getItem(TIMECLOCK_KEY) || "[]");
    return Array.isArray(list) ? list.filter((p) => p && typeof p.id === "string" && typeof p.at === "string") : [];
  } catch {
    return [];
  }
}

export function savePunches(list: Punch[]) {
  localStorage.setItem(TIMECLOCK_KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(TIMECLOCK_EVENT));
}

/** Último registro del empleado (para saber si lo que sigue es entrada o salida) */
export function lastPunch(userId: number, list = getPunches()): Punch | undefined {
  return list.filter((p) => p.userId === userId).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
}

/** Qué le toca marcar: salida si su último registro es una entrada de hace menos de MAX_SHIFT_HOURS */
export function nextPunchType(userId: number, list = getPunches(), now = Date.now()): PunchType {
  const last = lastPunch(userId, list);
  if (!last || last.type === "salida") return "entrada";
  return now - Date.parse(last.at) < MAX_SHIFT_HOURS * 3600_000 ? "salida" : "entrada";
}

export function addPunch(user: { id: number; name: string }, type: PunchType, at = new Date()): Punch {
  const punch: Punch = { id: `chk-${at.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, userId: user.id, userName: user.name, type, at: at.toISOString() };
  savePunches([...getPunches(), punch]);
  return punch;
}

export type WorkDay = { date: string; userId: number; userName: string; in?: string; out?: string; hours: number; open: boolean };

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Jornadas por empleado y día: cada entrada se cierra con la siguiente
 * salida; una entrada sin salida queda abierta (horas hasta ahora, tope
 * MAX_SHIFT_HOURS).
 */
export function workDays(list: Punch[], from: Date, to: Date, now = Date.now()): WorkDay[] {
  const sorted = [...list].filter((p) => Date.parse(p.at) >= from.getTime() && Date.parse(p.at) <= to.getTime()).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const byUser = new Map<number, Punch[]>();
  for (const p of sorted) byUser.set(p.userId, [...(byUser.get(p.userId) || []), p]);
  const out: WorkDay[] = [];
  for (const [userId, punches] of byUser) {
    let open: Punch | null = null;
    for (const p of punches) {
      if (p.type === "entrada") {
        if (open) out.push({ date: dayKey(open.at), userId, userName: open.userName, in: open.at, hours: 0, open: true });
        open = p;
      } else if (open) {
        const ms = Math.min(Date.parse(p.at) - Date.parse(open.at), MAX_SHIFT_HOURS * 3600_000);
        out.push({ date: dayKey(open.at), userId, userName: open.userName, in: open.at, out: p.at, hours: Math.max(0, ms) / 3600_000, open: false });
        open = null;
      } else {
        out.push({ date: dayKey(p.at), userId, userName: p.userName, out: p.at, hours: 0, open: false });
      }
    }
    if (open) {
      const ms = Math.min(now - Date.parse(open.at), MAX_SHIFT_HOURS * 3600_000);
      out.push({ date: dayKey(open.at), userId, userName: open.userName, in: open.at, hours: Math.max(0, ms) / 3600_000, open: true });
    }
  }
  return out.sort((a, b) => a.userName.localeCompare(b.userName, "es") || (a.in || a.out || "").localeCompare(b.in || b.out || ""));
}

/** Horas de cada empleado durante un turno de caja (checador): lo trabajado entre la apertura y el cierre. */
export function shiftStaffHours(openedAt: string, closedAt: string, list = getPunches(), now = Date.now()): { userName: string; hours: number; open: boolean }[] {
  const from = Date.parse(openedAt);
  const to = Date.parse(closedAt);
  // Se toman también las entradas de antes de abrir la caja (quien llegó antes)
  const days = workDays(list, new Date(from - MAX_SHIFT_HOURS * 3600_000), new Date(to), now);
  const byUser = new Map<string, { hours: number; open: boolean }>();
  for (const d of days) {
    if (!d.in) continue;
    const start = Math.max(Date.parse(d.in), from);
    const end = Math.min(d.out ? Date.parse(d.out) : to, to);
    if (end <= start) continue;
    const prev = byUser.get(d.userName) || { hours: 0, open: false };
    byUser.set(d.userName, { hours: prev.hours + (end - start) / 3600_000, open: prev.open || d.open });
  }
  return [...byUser.entries()].map(([userName, v]) => ({ userName, ...v })).sort((a, b) => b.hours - a.hours);
}

export function formatHours(h: number) {
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}
