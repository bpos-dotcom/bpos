import { NextResponse } from "next/server";
import { menuBrand } from "@/lib/menu-brand";

/**
 * La app instalable de cada restaurante: su menú digital con su nombre,
 * su logo y su color (cada liga es una app distinta a la de B-POS).
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const brand = await menuBrand(slug);
  if (!brand) return NextResponse.json({ error: "No existe." }, { status: 404 });
  const base = `/m/${brand.slug}`;
  const icon = (size: number, purpose: "any" | "maskable") => ({ src: `${base}/icono?size=${size}${purpose === "maskable" ? "&mask=1" : ""}`, sizes: `${size}x${size}`, type: "image/png", purpose });
  return new NextResponse(
    JSON.stringify({
      id: base,
      name: brand.name,
      short_name: brand.name.slice(0, 12),
      description: `Menú y pedidos de ${brand.name}`,
      start_url: base,
      scope: `${base}`,
      display: "standalone",
      orientation: "portrait",
      background_color: "#fff8f1",
      theme_color: brand.color,
      lang: "es-MX",
      icons: [icon(192, "any"), icon(512, "any"), icon(512, "maskable")],
    }),
    { headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=3600" } }
  );
}
