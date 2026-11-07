/**
 * Estudio de fotos con IA (plan Max, corre en Vercel): la foto de celular de
 * un platillo pasa a calidad de menú de restaurante sin cambiar el platillo.
 *
 * Cada foto gasta BPOS Credits del negocio (hora de México). Si se reinician
 * al día, a la semana o al mes (lib/ai/credits-period.ts), cuántos hay en ese
 * periodo y cuántos gasta cada foto los pone el administrador de B-POS en
 * Configuración → Administrador → Claves de IA → Estudio de fotos
 * (bpos_ai_image_settings, 0030). Los créditos usados viven en
 * bpos_ai_credits; si la foto falla se regresan.
 */
import { adminDb } from "@/lib/ai/settings";

/** Qué hacer con el fondo: conservarlo difuminado (de fábrica) o quitarlo (transparente) */
export type PhotoBackground = "conservar" | "quitar";

const PROMPT_START = `Mejora esta fotografía de un platillo de restaurante para que luzca como una foto profesional de menú, pero conservando fielmente el producto original.

Es muy importante mantener exactamente el mismo platillo y presentación original: mismos ingredientes, mismas cantidades, mismas porciones, mismo acomodo, mismo empaque o plato, mismo ángulo de cámara y misma composición general. No agregues, elimines, sustituyas ni reinterpretes ningún alimento, guarnición, salsa, empaque o elemento del platillo.

Haz únicamente mejoras fotográficas: corrige la iluminación para que sea suave, cálida y tipo estudio, mejora el color para que se vea natural y apetitoso, y aumenta ligeramente la nitidez y el enfoque.`;

const PROMPT_END = `El resultado debe verse como una fotografía real retocada profesionalmente, no como una imagen generada desde cero. No agregues texto, logotipos, marcas de agua ni elementos decorativos. Conserva intactos los logotipos, etiquetas y textos que ya estén impresos en los empaques originales.`;

/**
 * La orden que recibe la IA (la escribió y probó el dueño de B-POS): mejorar
 * la foto a nivel profesional de restaurante sin cambiar la estructura ni la
 * composición del platillo, conservando el fondo difuminado o quitándolo.
 */
export const PHOTO_PROMPTS: Record<PhotoBackground, string> = {
  conservar: `${PROMPT_START}

Limpia visualmente y difumina suavemente el fondo original, aplicando un desenfoque natural y discreto, similar al de una cámara profesional con profundidad de campo reducida. Mantén el entorno original reconocible, pero menos llamativo para que el platillo sea el protagonista. No sustituyas el fondo por otro escenario, no modifiques el ángulo de cámara y no desenfoques ninguna parte del producto, empaque, plato o acompañamientos.

${PROMPT_END}`,
  quitar: `${PROMPT_START}

Elimina completamente el fondo de la fotografía y sustitúyelo por transparencia real (canal alfa). Conserva únicamente el producto principal con todos sus elementos originales, incluyendo el plato o recipiente, empaques, papel, salsas y acompañamientos. Respeta cuidadosamente los bordes, las texturas, los reflejos y las sombras naturales del producto. No recortes ninguna parte del conjunto original ni agregues un fondo blanco, negro o de otro color.

${PROMPT_END}`,
};

/** El prompt que se usa: el que guardó el administrador o, si está vacío, el de fábrica */
export function photoPrompt(row: { prompt_keep?: string; prompt_remove?: string } | null, background: PhotoBackground) {
  const own = (background === "quitar" ? row?.prompt_remove : row?.prompt_keep)?.trim();
  return own || PHOTO_PROMPTS[background];
}

/** BPOS Credits que el negocio ya usó en el periodo (day: su primer día, ver creditsKey) */
export async function creditsUsed(businessId: string, day: string) {
  const { data, error } = await adminDb().from("bpos_ai_credits").select("used").eq("business_id", businessId).eq("day", day).maybeSingle();
  if (error) throw new Error(`No se pudieron leer los BPOS Credits: ${error.message}`);
  return Number(data?.used) || 0;
}

/** Gasta créditos si alcanzan; regresa los usados del periodo o null si no alcanzan */
export async function spendCredits(businessId: string, cost: number, limit: number, day: string) {
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
