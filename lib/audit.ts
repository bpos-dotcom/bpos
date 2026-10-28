export type AuditEvent = {
  id: string;
  category: string;
  action: string;
  description: string;
  createdAt: string;
  userId?: string;
  userName?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
};

const AUDIT_KEY = "bpos_audit_log";
const MAX_EVENTS = 5000;

function readAudit(): AuditEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(AUDIT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getAuditLog(): AuditEvent[] {
  return readAudit().sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function addAuditEvent(
  event: Omit<AuditEvent, "id" | "createdAt"> & { id?: string; createdAt?: string }
): AuditEvent {
  const saved: AuditEvent = {
    ...event,
    id: event.id || `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: event.createdAt || new Date().toISOString(),
  };

  if (typeof window !== "undefined") {
    const next = [saved, ...readAudit()].slice(0, MAX_EVENTS);
    localStorage.setItem(AUDIT_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("bpos:audit-updated"));
  }

  return saved;
}

export function clearAuditLog() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUDIT_KEY);
  window.dispatchEvent(new Event("bpos:audit-updated"));
}
