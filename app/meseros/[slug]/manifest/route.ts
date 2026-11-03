import { NextResponse } from "next/server";

/**
 * Manifest de la app de meseros: instalada en el celular abre directo en
 * /meseros/<liga> (el manifest general de B-POS abre en /inicio, el POS).
 */
export const dynamic = "force-static";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const start = `/meseros/${encodeURIComponent(slug)}`;
  return NextResponse.json(
    {
      name: "B-POS Meseros",
      short_name: "Meseros",
      description: "Toma la orden en la mesa y mándala a cocina.",
      id: start,
      start_url: start,
      scope: start,
      display: "standalone",
      orientation: "portrait",
      background_color: "#000000",
      theme_color: "#000000",
      lang: "es-MX",
      icons: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } }
  );
}
