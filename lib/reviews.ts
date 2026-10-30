"use client";
/**
 * Opiniones (Entrega 3): las calificaciones que dejan los clientes en la
 * liga de su pedido del menú digital. Las de 1 a 3 estrellas son solo para
 * el negocio: se atienden (WhatsApp al cliente) y se marcan "atendida".
 */
import { useEffect, useState } from "react";
import { agentScope } from "@/lib/agent/client";
import { getBusinessSettings } from "@/lib/business-settings";
import { whatsappNumber } from "@/lib/digital-menu";
import { getSupabase } from "@/lib/supabase/client";

export type Review = {
  id: string;
  folio: string;
  stars: number;
  comment: string;
  customer_name: string;
  customer_phone: string;
  status: "nueva" | "atendida";
  answer: string;
  attended_by: string;
  attended_at: string | null;
  created_at: string;
  updated_at: string;
};

export const REVIEWS_EVENT = "bpos:reviews-updated";

/** Opiniones de la sucursal de este dispositivo (las más nuevas primero). */
export async function listReviews(days = 90): Promise<Review[]> {
  const { branchId } = await agentScope();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await getSupabase()
    .from("bpos_reviews")
    .select("id, folio, stars, comment, customer_name, customer_phone, status, answer, attended_by, attended_at, created_at, updated_at")
    .eq("branch_id", branchId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data || []) as Review[];
}

/** Opiniones malas que nadie ha atendido */
export const needsAttention = (r: Pick<Review, "stars" | "status">) => r.stars <= 3 && r.status === "nueva";

export async function attendReview(id: string, answer: string, userName = "") {
  const { error } = await getSupabase()
    .from("bpos_reviews")
    .update({ status: "atendida", answer: answer.trim().slice(0, 300), attended_by: userName, attended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  window.dispatchEvent(new Event(REVIEWS_EVENT));
}

export async function reopenReview(id: string) {
  const { error } = await getSupabase().from("bpos_reviews").update({ status: "nueva", updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  window.dispatchEvent(new Event(REVIEWS_EVENT));
}

/** WhatsApp al cliente para atender su opinión ("" si no dejó teléfono) */
export function reviewWhatsappLink(review: Review) {
  const phone = whatsappNumber(review.customer_phone);
  if (!phone) return "";
  const name = review.customer_name.trim().split(/\s+/)[0] || "";
  const business = getBusinessSettings().businessName || "el negocio";
  const text = `Hola${name ? ` ${name}` : ""}, te escribimos de ${business}. Vimos tu opinión de tu pedido ${review.folio} y lamentamos que no haya sido como esperabas. ¿Nos cuentas qué pasó? Queremos arreglarlo.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

/** Cuántas opiniones malas esperan ser atendidas (para el menú lateral) */
export function usePendingReviews() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const { branchId } = await agentScope();
        const { count: n } = await getSupabase()
          .from("bpos_reviews")
          .select("id", { count: "exact", head: true })
          .eq("branch_id", branchId)
          .eq("status", "nueva")
          .lte("stars", 3);
        if (alive) setCount(n || 0);
      } catch {
        // sin internet o sin sesión: se intenta en la siguiente vuelta
      }
    };
    void check();
    const timer = setInterval(() => void check(), 60_000);
    const refresh = () => void check();
    window.addEventListener(REVIEWS_EVENT, refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener(REVIEWS_EVENT, refresh);
    };
  }, []);
  return count;
}
