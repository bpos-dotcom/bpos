/**
 * Proyecto de Supabase de Burger Planet.
 * La llave "publishable" es pública por diseño (va en el navegador y la
 * seguridad la da Row Level Security), así que puede vivir en el código.
 * Si existen las variables NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY en
 * .env.local o en Vercel, esas tienen prioridad.
 */
export const DEFAULT_SUPABASE_URL = "https://fhsqwbtkxpzvmqplwqul.supabase.co";
export const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_noKOXLF2fFBR2TCbgkxGRg__GlHxzbS";
