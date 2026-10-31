import { ImageResponse } from "next/og";
import { menuBrand } from "@/lib/menu-brand";

/**
 * Ícono de la app del restaurante: su logo sobre blanco (o sus iniciales
 * en su color si no tiene logo). ?size=192|512 · ?mask=1 deja margen para
 * los íconos redondos de Android.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const url = new URL(request.url);
  const size = [180, 192, 512].includes(Number(url.searchParams.get("size"))) ? Number(url.searchParams.get("size")) : 512;
  const mask = url.searchParams.get("mask") === "1";
  const brand = await menuBrand(slug);
  const color = brand?.color || "#f97316";
  const initials = (brand?.name || "M")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const inner = Math.round(size * (mask ? 0.62 : 0.8));

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: brand?.logo ? "#ffffff" : color }}>
        {brand?.logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- Satori dibuja <img>
          <img src={brand.logo} alt="" width={inner} height={inner} style={{ objectFit: "contain" }} />
        ) : (
          <span style={{ fontSize: inner * 0.55, fontWeight: 900, color: "#ffffff" }}>{initials}</span>
        )}
      </div>
    ),
    { width: size, height: size, headers: { "cache-control": "public, max-age=3600" } }
  );
}
