/**
 * A qué nube habla B-POS (todos los negocios; cada uno ve solo lo suyo).
 *
 * Desde el 22 nov 2026 la nube es la de Cloudflare (docs/mudanza-cloudflare.md):
 * www.bpos.com.mx/sb contesta igual que Supabase, sobre D1/R2. Supabase se
 * queda intacto de respaldo: para regresar, NUBE = "supabase" y publicar
 * (y copiar de regreso lo nuevo: scripts/nube-regresar.ts).
 *
 * Las llaves "publishable"/anónimas son públicas por diseño (van en el
 * navegador; la seguridad la dan las reglas por negocio). Si existen las
 * variables NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY, esas tienen prioridad
 * (la versión aparte bpos-nube y las pruebas locales las usan).
 */
export const NUBE: "cloudflare" | "supabase" = "cloudflare";

/** Supabase (respaldo; la nube de antes) */
export const SUPABASE_PROJECT_URL = "https://fhsqwbtkxpzvmqplwqul.supabase.co";
export const SUPABASE_PROJECT_KEY = "sb_publishable_noKOXLF2fFBR2TCbgkxGRg__GlHxzbS";

/** Nube de Cloudflare (la llave anónima es la NUBE_ANON_KEY del Worker) */
export const CLOUDFLARE_NUBE_URL = "https://www.bpos.com.mx/sb";
export const CLOUDFLARE_NUBE_KEY = "nube_publica_lGH7Xv44TOqsDqLEcm_FrVdJ";

export const DEFAULT_SUPABASE_URL = NUBE === "cloudflare" ? CLOUDFLARE_NUBE_URL : SUPABASE_PROJECT_URL;
export const DEFAULT_SUPABASE_PUBLISHABLE_KEY = NUBE === "cloudflare" ? CLOUDFLARE_NUBE_KEY : SUPABASE_PROJECT_KEY;
