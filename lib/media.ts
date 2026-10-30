"use client";
/**
 * Fotos del negocio en la nube (Supabase Storage, carpeta bpos-media/<negocio>):
 * fotos de productos y del diseño del menú digital. Antes de subirlas se
 * reducen y se pasan a WEBP para que el menú cargue rápido en el celular.
 * Se guardan con nombre nuevo cada vez (así el celular nunca muestra la vieja).
 */
import { agentScope } from "@/lib/agent/client";
import { getSupabase } from "@/lib/supabase/client";

const BUCKET = "bpos-media";

async function toWebp(file: File, maxSide: number): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("No se pudo abrir la imagen."));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("El navegador no pudo procesar la imagen.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
    if (!blob) throw new Error("No se pudo preparar la imagen.");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Sube una foto y regresa su dirección pública.
 * `folder`: "productos", "menu"...; `maxSide`: tamaño máximo en pixeles.
 */
export async function uploadBusinessImage(file: File, folder: string, maxSide = 1200): Promise<string> {
  if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) throw new Error("Sube una imagen JPG, PNG o WEBP.");
  const { businessId } = await agentScope();
  const blob = await toWebp(file, maxSide);
  const path = `${businessId}/${folder}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}.webp`;
  const { error } = await getSupabase().storage.from(BUCKET).upload(path, blob, { contentType: "image/webp", cacheControl: "31536000" });
  if (error) throw new Error(error.message);
  return getSupabase().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Sube un audio del negocio (avisos de Notificaciones) tal cual; máximo 3 MB. */
export async function uploadBusinessAudio(file: File): Promise<string> {
  if (!/^audio\//i.test(file.type)) throw new Error("Sube un audio MP3, WAV, OGG o M4A.");
  if (file.size > 3 * 1024 * 1024) throw new Error("El audio pesa más de 3 MB. Usa uno más corto.");
  const { businessId } = await agentScope();
  const ext = (file.name.split(".").pop() || "mp3").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "mp3";
  const path = `${businessId}/sonidos/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await getSupabase().storage.from(BUCKET).upload(path, file, { contentType: file.type, cacheControl: "31536000" });
  if (error) throw new Error(error.message);
  return getSupabase().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
