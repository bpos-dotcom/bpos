/**
 * Lo que hacían los triggers de Supabase al escribir, en el mismo orden:
 *
 * sync_records
 *  - sync_orders_keep_money (antes de cambiar): una venta cobrada no regresa a
 *    "en espera" ni una cancelada a activa por una copia vieja de otro equipo.
 *  - sync_records_a_keep_sales: las ventas (bpos_orders) no se borran ni se
 *    marcan como borradas.
 *  - sync_records_touch: cada cambio lleva un número nuevo (seq) y la hora.
 *  - sync_heads_bump (después): el último número por negocio (para avisar).
 * audit_events: la hora de llegada la pone la nube; no se cambia ni se borra.
 * businesses: un negocio nuevo empieza en prueba; el plan solo lo cambia el
 * servidor o un administrador.
 */
import type { Row } from "./db";
import type { Auth } from "./access";
import { RestError } from "./postgrest";
import { nowIso } from "./values";

export type TriggerCtx = {
  auth: Auth;
  isAdmin: () => Promise<boolean>;
  /** Reserva un número de la secuencia (sync_seq) */
  nextSeq: (name: string) => Promise<number>;
};

const plusDays = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
const privileged = async (ctx: TriggerCtx) => ctx.auth.role === "service" || (await ctx.isAdmin());

/** Antes de insertar. Regresa la fila a guardar */
export async function beforeInsert(table: string, row: Row, ctx: TriggerCtx): Promise<Row> {
  if (table === "sync_records") return { ...row, seq: await ctx.nextSeq("sync_seq"), updated_at: nowIso() };
  if (table === "audit_events") return { ...row, received_at: nowIso() };
  if (table === "businesses" && !(await privileged(ctx))) {
    return { ...row, plan: "basic", plan_status: "trial", trial_ends_at: plusDays(14), paid_until: null, branches_paid: 1, ai_budget_usd: null };
  }
  return row;
}

const KEEP_PAID = ["pendingPayment", "paidAt", "paidBy", "paidShiftSessionId", "tip", "tipPayments", "partialPayments"];
const KEEP_PAID_DETAILS = ["paymentMethod", "payments", "couponCode"];
const KEEP_CANCELLED = ["cancelled", "cancelledAt", "cancelledBy", "cancelReason"];
const truthy = (v: unknown) => v === true || v === "true";

/** sync_orders_keep_money: lo cobrado y lo cancelado no se deshace */
export function keepMoney(oldData: Record<string, unknown> | null, newData: Record<string, unknown> | null) {
  if (!oldData || !newData || typeof oldData !== "object" || typeof newData !== "object") return newData;
  const next: Record<string, unknown> = { ...newData };
  if (!truthy(oldData.pendingPayment) && truthy(next.pendingPayment) && !truthy(next.cancelled)) {
    for (const k of KEEP_PAID) {
      if (k in oldData) next[k] = oldData[k];
      else delete next[k];
    }
    if (next.details && typeof next.details === "object" && !Array.isArray(next.details)) {
      const oldDetails = (oldData.details && typeof oldData.details === "object" ? oldData.details : {}) as Record<string, unknown>;
      const details = { ...(next.details as Record<string, unknown>) };
      for (const k of KEEP_PAID_DETAILS) {
        if (k in oldDetails) details[k] = oldDetails[k];
        else delete details[k];
      }
      next.details = details;
    }
  }
  if (truthy(oldData.cancelled) && !truthy(next.cancelled)) {
    for (const k of KEEP_CANCELLED) if (k in oldData) next[k] = oldData[k];
  }
  return next;
}

/** Antes de cambiar. Regresa la fila a guardar (los datos llegan ya leídos: data como objeto) */
export async function beforeUpdate(table: string, oldRow: Row, newRow: Row, ctx: TriggerCtx): Promise<Row> {
  if (table === "audit_events") throw new RestError(400, "P0001", "La bitácora de B-POS no se puede modificar ni borrar.");
  if (table === "sync_records") {
    let next = { ...newRow };
    if (next.collection === "bpos_orders" && !next.deleted) next.data = keepMoney(oldRow.data as Record<string, unknown> | null, next.data as Record<string, unknown> | null);
    // Marcar una venta como borrada: se conserva como estaba
    if (next.collection === "bpos_orders" && next.deleted && !oldRow.deleted) next = { ...oldRow };
    return { ...next, seq: await ctx.nextSeq("sync_seq"), updated_at: nowIso() };
  }
  if (table === "businesses") {
    if (await privileged(ctx)) {
      if (newRow.plan !== oldRow.plan || newRow.plan_status !== oldRow.plan_status) return { ...newRow, plan_updated_at: nowIso() };
      return newRow;
    }
    const keep = ["plan", "plan_status", "trial_ends_at", "paid_until", "branches_paid", "ai_budget_usd", "mp_preapproval_id", "mp_payer_email", "plan_updated_at", "billing_period"];
    const next = { ...newRow };
    for (const k of keep) next[k] = oldRow[k];
    return next;
  }
  return newRow;
}

/** Antes de borrar: false = no se borra (sin error) */
export async function beforeDelete(table: string, oldRow: Row): Promise<boolean> {
  if (table === "audit_events") throw new RestError(400, "P0001", "La bitácora de B-POS no se puede modificar ni borrar.");
  if (table === "sync_records" && oldRow.collection === "bpos_orders") return false;
  return true;
}
