/**
 * Estudio de fotos con IA (plan Max, corre en Vercel): la foto de celular de
 * un platillo pasa a calidad de menú de restaurante sin cambiar el platillo.
 *
 * Cada foto gasta BPOS Credits del día del negocio (hora de México). Cuántos
 * hay al día y cuántos gasta cada foto los pone el administrador de B-POS en
 * Configuración → Administrador → Claves de IA → Estudio de fotos
 * (bpos_ai_photo_settings, 0029). Los créditos usados viven en
 * bpos_ai_credits; si la foto falla se regresan.
 */
import { adminDb } from "@/lib/ai/settings";

/**
 * La orden que recibe la IA. En inglés porque el modelo la sigue mejor; dice
 * lo mismo que se le explica al dueño: mejorar la foto a nivel profesional de
 * restaurante sin cambiar la estructura ni la composición del platillo.
 */
export const PHOTO_PROMPT = `Edit this photo of a restaurant dish so it looks like a professional food photograph for a restaurant menu.

Keep EXACTLY the same dish: the same ingredients, quantities, portion sizes, arrangement, plate or container, camera angle, framing and composition. Do not add, remove, move, resize or replace any ingredient, garnish, sauce, side, plate, utensil or prop. Do not change the shape or structure of the food.

Only improve the photographic quality:
- soft, warm, even studio lighting with gentle natural shadows;
- natural, appetizing colors and correct white balance (no oversaturation);
- sharp focus and fine texture on the food; remove noise, blur and grain;
- clean up the background: remove clutter, stains and distracting objects, or softly blur it, keeping the same surface and setting.

No text, logos, labels, watermarks or borders. The result must look like a real photograph of this exact dish, not an illustration, render or a different dish.`;

/** Día de hoy en México (los créditos se reinician a medianoche de aquí) */
export function creditsDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** BPOS Credits que el negocio ya usó hoy */
export async function creditsUsed(businessId: string, day = creditsDay()) {
  const { data, error } = await adminDb().from("bpos_ai_credits").select("used").eq("business_id", businessId).eq("day", day).maybeSingle();
  if (error) throw new Error(`No se pudieron leer los BPOS Credits: ${error.message}`);
  return Number(data?.used) || 0;
}

/** Gasta créditos si alcanzan; regresa los usados del día o null si no alcanzan */
export async function spendCredits(businessId: string, cost: number, limit: number, day = creditsDay()) {
  const { data, error } = await adminDb().rpc("bpos_ai_credits_spend", { p_business_id: businessId, p_day: day, p_cost: cost, p_limit: limit });
  if (error) throw new Error(`No se pudieron usar los BPOS Credits: ${error.message}`);
  const used = Number(data);
  return used >= 0 ? used : null;
}

/** Regresa los créditos de una foto que no salió */
export async function refundCredits(businessId: string, cost: number, day: string) {
  const { error } = await adminDb().rpc("bpos_ai_credits_refund", { p_business_id: businessId, p_day: day, p_cost: cost });
  if (error) console.error("[B-POS] No se pudieron regresar los BPOS Credits:", error.message);
}
