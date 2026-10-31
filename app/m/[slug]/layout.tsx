import type { Metadata, Viewport } from "next";
import { menuBrand } from "@/lib/menu-brand";

/**
 * Título, color y app instalable del menú digital de cada restaurante (la
 * página en sí es de cliente: app/m/[slug]/page.tsx).
 */
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const brand = await menuBrand(slug);
  if (!brand) return { title: "Menú digital" };
  return {
    title: `${brand.name} · Menú y pedidos`,
    description: `Pide en línea a ${brand.name}, sin comisiones.`,
    manifest: `/m/${brand.slug}/manifest.webmanifest`,
    icons: { icon: `/m/${brand.slug}/icono?size=192`, apple: `/m/${brand.slug}/icono?size=180` },
    appleWebApp: { capable: true, title: brand.name, statusBarStyle: "default" },
  };
}

export async function generateViewport({ params }: Props): Promise<Viewport> {
  const { slug } = await params;
  const brand = await menuBrand(slug);
  return { themeColor: brand?.color || "#f97316" };
}

export default function MenuLayout({ children }: { children: React.ReactNode }) {
  return children;
}
