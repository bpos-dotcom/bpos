import { queueCloudAudit } from "@/lib/cloud/audit-outbox";
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
/**
 * En la caja solo se quedan los más recientes: la copia completa (que nadie
 * puede borrar) está en la nube. Con 5000 se llenaba la memoria del navegador.
 */
const MAX_EVENTS = 1000;

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
    // Nunca debe trabar la caja: si la memoria está llena se guardan menos
    let next = [saved, ...readAudit()].slice(0, MAX_EVENTS);
    for (;;) {
      try {
        localStorage.setItem(AUDIT_KEY, JSON.stringify(next));
        break;
      } catch (e) {
        if (next.length <= 50) {
          console.warn("[auditoría] no se pudo guardar en la caja (ya va a la nube)", e);
          break;
        }
        next = next.slice(0, Math.floor(next.length / 2));
      }
    }
    window.dispatchEvent(new Event("bpos:audit-updated"));
    // Copia en la nube que nadie puede editar ni borrar
    queueCloudAudit(saved);
  }

  return saved;
}

export function clearAuditLog() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUDIT_KEY);
  window.dispatchEvent(new Event("bpos:audit-updated"));
}
