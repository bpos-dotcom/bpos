/**
 * Marca de agua "Versión Cloudflare" arriba a la derecha: sale solo cuando
 * B-POS se compiló para la nube de Cloudflare (NEXT_PUBLIC_BPOS_NUBE), así el
 * dueño sabe a simple vista qué versión está usando. No estorba los clics.
 */
import { SUPABASE_URL } from "@/lib/supabase/client";

/** Cloudflare si así se compiló o si la dirección de la nube es la de Cloudflare (termina en /sb) */
export const NUBE_KIND = process.env.NEXT_PUBLIC_BPOS_NUBE === "cloudflare" || SUPABASE_URL.endsWith("/sb") ? "cloudflare" : "supabase";

export function NubeBadge() {
  if (NUBE_KIND !== "cloudflare") return null;
  return (
    <div
      aria-hidden
      data-nube-badge
      className="pointer-events-none fixed right-2 top-1 z-[9999] select-none rounded-full border border-orange-400/60 bg-black/70 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-orange-300 shadow-lg backdrop-blur"
    >
      ☁️ Versión Cloudflare
    </div>
  );
}
