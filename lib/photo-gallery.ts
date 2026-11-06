"use client";
/**
 * Galería de fotos del negocio (Tu negocio → Estudio IA): las fotos que se
 * suben, mejoradas con IA o tal cual. Desde Productos se elige una de aquí
 * para cada producto. Es del negocio (todas las sucursales la ven) y se
 * sincroniza como los productos; las fotos viven en bpos-media/<negocio>/galeria.
 * Quitar una foto de la galería no se la quita a los productos que ya la usan.
 */
import { uploadBusinessImage } from "@/lib/media";

export type GalleryPhoto = {
  id: string;
  url: string;
  name: string;
  /** Mejorada con el Estudio de fotos con IA */
  enhanced: boolean;
  createdAt: string;
};

const KEY = "bpos_photo_gallery"; // ver BUSINESS_KEYS en lib/cloud/sync.ts
export const GALLERY_EVENT = "bpos:photo-gallery-updated";

export function getGallery(): GalleryPhoto[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? (list as GalleryPhoto[]).filter((p) => p && typeof p.url === "string").sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];
  } catch {
    return [];
  }
}

function save(list: GalleryPhoto[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(GALLERY_EVENT));
}

/** Nombre de la foto a partir del archivo ("hamburguesa-clasica.jpg" → "hamburguesa clasica") */
export function photoName(fileName: string) {
  return fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim().slice(0, 60) || "Foto";
}

/** Sube la foto a la nube y la agrega a la galería */
export async function addToGallery(file: Blob, name: string, enhanced: boolean): Promise<GalleryPhoto> {
  const upload = file instanceof File ? file : new File([file], "foto.png", { type: file.type || "image/png" });
  const url = await uploadBusinessImage(upload, "galeria", 1200);
  const photo: GalleryPhoto = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, url, name: name.trim() || "Foto", enhanced, createdAt: new Date().toISOString() };
  save([photo, ...getGallery()]);
  return photo;
}

export function removeFromGallery(id: string) {
  save(getGallery().filter((p) => p.id !== id));
}
