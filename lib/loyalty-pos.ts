"use client";
/**
 * Club de clientes en la caja: buscar al socio (teléfono o código de su
 * tarjeta), sumarle por la venta y canjear premios o saldo. Todo pasa por
 * funciones de la nube que revisan que sea del negocio (migración 0016).
 */
import { aiFetch } from "@/lib/ai/client";
import type { LoyaltyMovement } from "@/lib/loyalty";
import { getSupabase } from "@/lib/supabase/client";

export type ClubMember = {
  account_id: string;
  name: string;
  phone: string;
  code: string | null;
  member: boolean;
  points: number;
  stamps: number;
  cashback: number;
};

export async function findMembers(query: string): Promise<ClubMember[]> {
  const q = query.trim();
  if (q.replace(/\D/g, "").length < 10 && q.length < 6) return [];
  const { data, error } = await getSupabase().rpc("bpos_loyalty_find", { p_query: q });
  if (error) throw new Error(error.message);
  return ((data as ClubMember[]) || []).map((m) => ({ ...m, points: Number(m.points), stamps: Number(m.stamps), cashback: Number(m.cashback) }));
}

/**
 * Si el socio tiene la tarjeta en Google Wallet, le actualiza el saldo en el
 * celular y, con `mov` (lo que sumó o canjeó), le manda el aviso si el club
 * lo tiene activado. Lo hace la nube; si falla, la tarjeta se pone al día
 * en el siguiente movimiento.
 */
export function syncWalletCard(accountId: string, mov?: LoyaltyMovement) {
  void aiFetch("/api/club/wallet", { method: "POST", body: JSON.stringify({ accion: "socio", accountId, mov }) }).catch(() => undefined);
}

/** Suma de una venta (si no es socio o el club está apagado, no pasa nada) */
export async function earnLoyalty(accountId: string, amount: number, ref: string, by = "") {
  const { data, error } = await getSupabase().rpc("bpos_loyalty_earn", { p_account: accountId, p_amount: amount, p_ref: ref, p_by: by });
  if (error) throw new Error(error.message);
  const result = data as { member: boolean; points?: number; stamps?: number; cashback?: number; earned?: { points: number; stamps: number; cashback: number } };
  if (result?.member) syncWalletCard(accountId, { tipo: "suma", points: result.earned?.points || 0, stamps: result.earned?.stamps || 0, cashback: result.earned?.cashback || 0 });
  return result;
}

/** Referencia del regalo de bienvenida en el historial del club (una sola vez por socio) */
export const WELCOME_GIFT_REF = "regalo-bienvenida";

/** ¿Ya recibió su producto de regalo de bienvenida? */
export async function welcomeGiftClaimed(accountId: string) {
  const { data, error } = await getSupabase().from("bpos_loyalty_movements").select("id").eq("account_id", accountId).eq("ref", WELCOME_GIFT_REF).limit(1);
  if (error) throw new Error(error.message);
  return (data || []).length > 0;
}

/** Deja anotado que ya recibió su regalo (lo hace la nube; si ya lo tenía, avisa) */
export async function claimWelcomeGift(accountId: string, product: string, order: string, by = "") {
  const r = await aiFetch("/api/club/regalo", { method: "POST", body: JSON.stringify({ accountId, product, order, by }) });
  const b = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!r.ok || !b.ok) throw new Error(b.error || "No se pudo registrar el regalo.");
}

export async function redeemLoyalty(accountId: string, use: { points?: number; stamps?: number; cashback?: number }, note: string, ref = "", by = "") {
  const { data, error } = await getSupabase().rpc("bpos_loyalty_redeem", {
    p_account: accountId,
    p_points: use.points || 0,
    p_stamps: use.stamps || 0,
    p_cashback: use.cashback || 0,
    p_note: note,
    p_ref: ref,
    p_by: by,
  });
  if (error) throw new Error(error.message);
  syncWalletCard(accountId, { tipo: "canje", points: use.points || 0, stamps: use.stamps || 0, cashback: use.cashback || 0, note });
  return data as { points: number; stamps: number; cashback: number };
}
