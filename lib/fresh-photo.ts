/**
 * Fotos de evidencia: solo valen las que se acaban de tomar. Si el celular
 * no deja usar la cámara dentro de la página y abre su selector, una foto de
 * la galería trae la fecha de cuando se tomó (lastModified) y se rechaza.
 */
export const FRESH_PHOTO_MS = 3 * 60 * 1000;

export function isFreshPhoto(file: { lastModified?: number }, now = Date.now(), maxAgeMs = FRESH_PHOTO_MS) {
  const at = Number(file.lastModified || 0);
  if (!at) return false;
  return now - at <= maxAgeMs && at - now <= 60_000;
}

export const OLD_PHOTO_ERROR = "Esa foto no es de ahorita. Tómala en este momento con la cámara (no de la galería).";
