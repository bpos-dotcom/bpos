import type { Metadata, Viewport } from "next";
import { menuBrand } from "@/lib/menu-brand";

/** Título y color de la página del club de cada restaurante */
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const brand = await menuBrand(slug);
  if (!brand) return { title: "Club de clientes" };
  return {
    title: `Club ${brand.name} · Tu tarjeta`,
    description: `Junta y canjea en ${brand.name}.`,
    icons: { icon: `/m/${brand.slug}/icono?size=192`, apple: `/m/${brand.slug}/icono?size=180` },
  };
}

export async function generateViewport({ params }: Props): Promise<Viewport> {
  const { slug } = await params;
  const brand = await menuBrand(slug);
  return { themeColor: brand?.color || "#f97316" };
}

export default function FidelidadLayout({ children }: { children: React.ReactNode }) {
  return children;
}
