export type CashMovementHistory = {
  id: number;
  type: "Gasto" | "Retiro" | "Retiro dueño" | "Ingreso extra";
  amount: number;
  reason: string;
  createdAt: string;
  userName?: string;
};

export type CashCloseRecord = {
  id: string;
  folio: string;
  shiftSessionId: string;
  openedAt: string;
  closedAt: string;
  openedBy?: string;
  closedBy?: string;
  openingCash: number;
  countedCash: number;
  expectedCash: number;
  difference: number;
  differenceReason?: string;
  totalSales: number;
  orderCount: number;
  salesByPayment: {
    cash: number;
    card: number;
    transfer: number;
  };
  salesByChannel: {
    counter: number;
    whatsapp: number;
    uber: number;
    didi: number;
    other: number;
  };
  cashIn: number;
  cashOut: number;
  movements: CashMovementHistory[];
  /** Horas del personal en el turno (checador) */
  staffHours?: { userName: string; hours: number; open: boolean }[];
  shoppingListSent: boolean;
  shoppingListSentAt?: string;
  shoppingListSentBy?: string;
  whatsappPhone?: string;
  cutMessage: string;
  cutSentAt?: string;
  /**
   * Corte anulado (ej. de pruebas): se sigue viendo, pero él y las ventas de
   * su turno ya no cuentan en reportes, finanzas, dashboard ni app del dueño.
   */
  voided?: { at: string; by: string; authorizedBy: string; reason: string };
};

const HISTORY_KEY = "bpos_shift_history";

export function getCashCloseHistory(): CashCloseRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((record: Partial<CashCloseRecord>, index: number) => ({
        id: record.id || `legacy-${index}-${record.closedAt || Date.now()}`,
        folio: record.folio || "Corte anterior",
        shiftSessionId: record.shiftSessionId || "legacy",
        openedAt: record.openedAt || new Date().toISOString(),
        closedAt: record.closedAt || new Date().toISOString(),
        openedBy: record.openedBy,
        closedBy: record.closedBy,
        openingCash: Number(record.openingCash || 0),
        countedCash: Number(record.countedCash || 0),
        expectedCash: Number(record.expectedCash || 0),
        difference: Number(record.difference || 0),
        differenceReason: record.differenceReason,
        totalSales: Number(record.totalSales || 0),
        orderCount: Number(record.orderCount || 0),
        salesByPayment: record.salesByPayment || { cash: 0, card: 0, transfer: 0 },
        salesByChannel:
          record.salesByChannel || { counter: 0, whatsapp: 0, uber: 0, didi: 0, other: 0 },
        cashIn: Number(record.cashIn || 0),
        cashOut: Number(record.cashOut || 0),
        movements: Array.isArray(record.movements) ? record.movements : [],
        shoppingListSent: Boolean(record.shoppingListSent),
        shoppingListSentAt: record.shoppingListSentAt,
        shoppingListSentBy: record.shoppingListSentBy,
        whatsappPhone: record.whatsappPhone,
        cutMessage: record.cutMessage || "",
        cutSentAt: record.cutSentAt,
        ...(record.staffHours ? { staffHours: record.staffHours } : {}),
        ...(record.voided ? { voided: record.voided } : {}),
      }))
      .sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime());
  } catch {
    return [];
  }
}

/** Turnos de cortes anulados: sus ventas no cuentan en reportes ni finanzas */
export function voidedShiftIds(history = getCashCloseHistory()): Set<string> {
  return new Set(history.filter((r) => r.voided && r.shiftSessionId && r.shiftSessionId !== "legacy").map((r) => r.shiftSessionId));
}

/** ¿La venta es de un turno anulado? */
export const inVoidedShift = (order: { shiftSessionId?: string }, voided: Set<string>) => Boolean(order.shiftSessionId && voided.has(order.shiftSessionId));

/** Anula un corte (con motivo y el admin que autorizó). No se borra: queda marcado. */
export function voidCashClose(id: string, voided: NonNullable<CashCloseRecord["voided"]>) {
  const history = getCashCloseHistory();
  const record = history.find((r) => r.id === id);
  if (!record) return null;
  const next = { ...record, voided };
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.map((r) => (r.id === id ? next : r))));
  window.dispatchEvent(new Event("bpos:cash-history-updated"));
  return next;
}

export function saveCashCloseRecord(record: CashCloseRecord) {
  if (typeof window === "undefined") return;
  const current = getCashCloseHistory().filter((item) => item.id !== record.id);
  localStorage.setItem(HISTORY_KEY, JSON.stringify([record, ...current]));
  window.dispatchEvent(new Event("bpos:cash-history-updated"));
}
