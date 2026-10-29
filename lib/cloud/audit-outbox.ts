"use client";
/**
 * Bitácora en la nube (bloque 11, tabla audit_events de 0004_bpos_bitacora.sql).
 *
 * Cada evento de la bitácora (addAuditEvent) también se manda a la nube,
 * donde nadie puede editarlo ni borrarlo. Sin internet se guardan en una
 * cola de este dispositivo y se mandan cuando vuelve la conexión.
 */
import type { AuditEvent } from "@/lib/audit";
import { loadCloudAccount } from "@/lib/cloud/account";
import { getSupabase, isCloudConfigured } from "@/lib/supabase/client";
import { flushPushEvents, queuePushEvents } from "@/lib/push/client";
import { PUSH_ACTIONS } from "@/lib/push/rules";

const OUTBOX_KEY = "bpos_audit_outbox"; // solo de este dispositivo (ver DEVICE_LOCAL_KEYS)
const MAX_QUEUE = 5000;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

function readQueue(): AuditEvent[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: AuditEvent[]) {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
}

export function pendingCloudAudit() {
  return typeof window === "undefined" ? 0 : readQueue().length;
}

/** Agrega un evento a la cola y la manda en unos segundos. */
export function queueCloudAudit(event: AuditEvent) {
  if (typeof window === "undefined" || !isCloudConfigured) return;
  writeQueue([...readQueue(), event]);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flushCloudAudit(), 2000);
}

/** Manda la cola a la nube (los repetidos se ignoran). */
export async function flushCloudAudit() {
  if (flushing || typeof window === "undefined" || !isCloudConfigured) return;
  const queue = readQueue();
  if (!queue.length) return flushPushEvents();
  flushing = true;
  try {
    const account = await loadCloudAccount();
    if (account.status !== "ready") return;
    const device = localStorage.getItem("bpos_device_id") || null;
    for (let i = 0; i < queue.length; i += 200) {
      const batch = queue.slice(i, i + 200).map((e) => ({
        business_id: account.businessId,
        branch_id: account.branchId,
        event_id: e.id,
        category: e.category,
        action: e.action,
        description: e.description,
        user_name: e.userName ?? null,
        user_id: e.userId ?? null,
        entity_id: e.entityId ?? null,
        device_id: device,
        metadata: e.metadata ?? null,
        happened_at: e.createdAt,
      }));
      const { error } = await getSupabase()
        .from("audit_events")
        .upsert(batch, { onConflict: "business_id,event_id", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      // Quita de la cola solo lo que ya subió (pudieron llegar eventos nuevos mientras tanto)
      const sent = new Set(batch.map((b) => b.event_id));
      writeQueue(readQueue().filter((e) => !sent.has(e.id)));
      // Ya están en la nube: B-POS en Vercel puede avisar al celular del dueño
      queuePushEvents(batch.filter((b) => PUSH_ACTIONS.has(b.action)).map((b) => b.event_id));
    }
  } catch {
    // sin internet o falta aplicar 0004 en Supabase: se reintenta después
  } finally {
    flushing = false;
  }
  await flushPushEvents();
}

/** Últimos eventos de la bitácora en la nube (para Configuración → Bitácora). */
export async function loadCloudAudit(limit = 200) {
  const account = await loadCloudAccount();
  if (account.status !== "ready") return null;
  const { data, error } = await getSupabase()
    .from("audit_events")
    .select("event_id, category, action, description, user_name, device_id, happened_at, received_at")
    .eq("business_id", account.businessId)
    .order("happened_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data as { event_id: string; category: string; action: string; description: string; user_name: string | null; device_id: string | null; happened_at: string; received_at: string }[];
}
