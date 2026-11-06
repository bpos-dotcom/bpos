"use client";
/**
 * Reservaciones de mesa hechas desde el menú digital (migración 0024):
 * el negocio las ve en Pedidos en línea → Reservaciones, las confirma o
 * rechaza y le avisa al cliente por WhatsApp (gratis, wa.me).
 */
import { agentScope } from "@/lib/agent/client";
import { getBusinessSettings } from "@/lib/business-settings";
import { whatsappNumber } from "@/lib/digital-menu";
import { getSupabase } from "@/lib/supabase/client";
import { whatsappLink } from "@/lib/whatsapp";

export type ReservationStatus = "nueva" | "confirmada" | "rechazada" | "cancelada" | "llego" | "no_llego";
export type Reservation = {
  id: string;
  customer_name: string;
  customer_phone: string;
  people: number;
  reserved_at: string;
  note: string;
  status: ReservationStatus;
  reason: string;
  attended_by: string;
  created_at: string;
};

export const RESERVATIONS_EVENT = "bpos:reservations-updated";

/** Reservaciones de la sucursal: las pendientes y las de los próximos 30 días (y las de ayer, por si acaso) */
export async function listReservations(): Promise<Reservation[]> {
  const { branchId } = await agentScope();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await getSupabase()
    .from("bpos_reservations")
    .select("id, customer_name, customer_phone, people, reserved_at, note, status, reason, attended_by, created_at")
    .eq("branch_id", branchId)
    .or(`reserved_at.gte.${since},status.eq.nueva`)
    .order("reserved_at", { ascending: true })
    .limit(300);
  if (error) throw new Error(error.message);
  return (data || []) as Reservation[];
}

export async function setReservationStatus(id: string, status: ReservationStatus, reason = "", by = "") {
  const { error } = await getSupabase()
    .from("bpos_reservations")
    .update({ status, reason, attended_by: by, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  window.dispatchEvent(new Event(RESERVATIONS_EVENT));
}

export function reservationWhen(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })} a las ${d.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" })}`;
}

/** Mensaje de WhatsApp para el cliente al confirmar o rechazar */
export function reservationWhatsappLink(r: Reservation, status: "confirmada" | "rechazada", reason = "") {
  const phone = whatsappNumber(r.customer_phone);
  if (!phone) return "";
  const business = getBusinessSettings().businessName || "nuestro restaurante";
  const name = (r.customer_name || "").trim().split(/\s+/)[0];
  const hi = name ? `${name}, ` : "";
  const text =
    status === "confirmada"
      ? `✅ ${hi}tu reservación en ${business} está confirmada: mesa para ${r.people} el ${reservationWhen(r.reserved_at)}. ¡Te esperamos!`
      : `😔 ${hi}no podemos confirmar tu reservación en ${business} para el ${reservationWhen(r.reserved_at)}${reason ? ` (${reason})` : ""}. Escríbenos y buscamos otra hora.`;
  return whatsappLink(phone, text);
}
