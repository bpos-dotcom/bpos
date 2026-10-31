"use client";
/**
 * Club de clientes en la caja: buscar al socio (teléfono o código de su
 * tarjeta), sumarle por la venta y canjear premios o saldo. Todo pasa por
 * funciones de la nube que revisan que sea del negocio (migración 0016).
 */
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

/** Suma de una venta (si no es socio o el club está apagado, no pasa nada) */
export async function earnLoyalty(accountId: string, amount: number, ref: string, by = "") {
  const { data, error } = await getSupabase().rpc("bpos_loyalty_earn", { p_account: accountId, p_amount: amount, p_ref: ref, p_by: by });
  if (error) throw new Error(error.message);
  return data as { member: boolean; points?: number; stamps?: number; cashback?: number; earned?: { points: number; stamps: number; cashback: number } };
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
  return data as { points: number; stamps: number; cashback: number };
}
