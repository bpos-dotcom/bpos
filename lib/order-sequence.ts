"use client";

const SHIFT_KEY = "bpos_active_shift";

export type ShiftSequenceState = {
  openedAt: string;
  sessionId?: string;
  orderCounter?: number;
  [key: string]: unknown;
};

function readActiveShift(): ShiftSequenceState | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(SHIFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveActiveShift(shift: ShiftSequenceState) {
  localStorage.setItem(SHIFT_KEY, JSON.stringify(shift));
  window.dispatchEvent(new Event("bpos:shift-updated"));
}

export function createShiftSessionId(openedAt: string) {
  return `shift-${openedAt}-${Math.random().toString(36).slice(2, 9)}`;
}

export function getActiveShiftSessionId(): string | null {
  const shift = readActiveShift();
  if (!shift) return null;

  if (shift.sessionId) return shift.sessionId;

  const sessionId = createShiftSessionId(shift.openedAt);
  saveActiveShift({ ...shift, sessionId, orderCounter: shift.orderCounter || 0 });
  return sessionId;
}

export function allocateShiftOrderNumber(): {
  localOrderNumber: number;
  shiftSessionId: string;
} {
  const shift = readActiveShift();

  if (!shift) {
    throw new Error("La caja está cerrada. Abre un turno antes de crear pedidos.");
  }

  const sessionId = shift.sessionId || createShiftSessionId(shift.openedAt);
  const localOrderNumber = Math.max(0, Number(shift.orderCounter) || 0) + 1;

  saveActiveShift({
    ...shift,
    sessionId,
    orderCounter: localOrderNumber,
  });

  return { localOrderNumber, shiftSessionId: sessionId };
}

export function getNextShiftOrderNumberPreview() {
  const shift = readActiveShift();
  if (!shift) return 1;
  return Math.max(0, Number(shift.orderCounter) || 0) + 1;
}

export function getVisibleOrderNumber(order: {
  id: number;
  localOrderNumber?: number;
}) {
  return Number(order.localOrderNumber || order.id || 0);
}

export function formatOrderNumber(order: {
  id: number;
  localOrderNumber?: number;
}) {
  return getVisibleOrderNumber(order).toString().padStart(6, "0");
}
