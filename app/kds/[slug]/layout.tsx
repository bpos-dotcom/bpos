import type { Metadata } from "next";

/** La app de cocina para tablets se instala con su propio manifest (abre en su liga, no en el POS). */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: "B-POS Cocina",
    manifest: `/kds/${encodeURIComponent(slug)}/manifest`,
    appleWebApp: { capable: true, title: "Cocina", statusBarStyle: "black-translucent" },
  };
}

export default function KdsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
