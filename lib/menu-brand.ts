/**
 * Nombre, logo y color del restaurante de una liga del menú digital, para
 * la app instalable (manifiesto e ícono) y el título de la página. Solo
 * corre en el servidor.
 */
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/client";

export type MenuBrand = { slug: string; name: string; logo: string; color: string };

const COLOR_RE = /^#[0-9a-f]{6}$/i;

export async function menuBrand(slugIn: string): Promise<MenuBrand | null> {
  const slug = String(slugIn || "").toLowerCase().trim();
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return null;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    if (serviceKey) {
      // Con la llave de servicio se lee solo lo necesario
      const db = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: link } = await db.from("bpos_menu_links").select("business_id").eq("slug", slug).maybeSingle();
      if (!link) return null;
      const [{ data: settings }, { data: business }] = await Promise.all([
        db.from("sync_records").select("data").eq("business_id", link.business_id).eq("scope", "business").eq("collection", "bpos_business_settings").eq("record_id", "__doc__").maybeSingle(),
        db.from("businesses").select("name").eq("id", link.business_id).maybeSingle(),
      ]);
      const s = (settings?.data || {}) as { businessName?: string; brandLogo?: string; brandColor?: string };
      return {
        slug,
        name: s.businessName || business?.name || "Menú digital",
        logo: typeof s.brandLogo === "string" && s.brandLogo.startsWith("data:image/") ? s.brandLogo : "",
        color: COLOR_RE.test(s.brandColor || "") ? s.brandColor! : "#f97316",
      };
    }
    const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await db.rpc("bpos_menu_public", { p_slug: slug });
    const b = (data as { business?: { name?: string; logo?: string; color?: string } } | null)?.business;
    if (!b) return null;
    return { slug, name: b.name || "Menú digital", logo: b.logo?.startsWith("data:image/") ? b.logo : "", color: COLOR_RE.test(b.color || "") ? b.color! : "#f97316" };
  } catch {
    return null;
  }
}
