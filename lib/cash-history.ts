export type CashMovementHistory = {
  id: number;
  type: "Gasto" | "Retiro" | "Ingreso extra";
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
  shoppingListSent: boolean;
  shoppingListSentAt?: string;
  shoppingListSentBy?: string;
  whatsappPhone?: string;
  cutMessage: string;
  cutSentAt?: string;
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
      }))
      .sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime());
  } catch {
    return [];
  }
}

export function saveCashCloseRecord(record: CashCloseRecord) {
  if (typeof window === "undefined") return;
  const current = getCashCloseHistory().filter((item) => item.id !== record.id);
  localStorage.setItem(HISTORY_KEY, JSON.stringify([record, ...current]));
  window.dispatchEvent(new Event("bpos:cash-history-updated"));
}
