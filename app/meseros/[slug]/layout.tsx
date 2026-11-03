import type { Metadata } from "next";

/** La app de meseros se instala con su propio manifest (abre en su liga, no en el POS). */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: "B-POS Meseros",
    manifest: `/meseros/${encodeURIComponent(slug)}/manifest`,
    appleWebApp: { capable: true, title: "Meseros", statusBarStyle: "black-translucent" },
  };
}

export default function MeserosLayout({ children }: { children: React.ReactNode }) {
  return children;
}
