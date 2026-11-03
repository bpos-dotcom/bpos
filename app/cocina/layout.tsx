import type { Metadata } from "next";

/** Cocina (KDS) se instala como app propia en la tablet de la estación: abre en /cocina. */
export const metadata: Metadata = {
  title: "B-POS · Cocina",
  manifest: "/cocina/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Cocina", statusBarStyle: "black-translucent" },
};

export default function CocinaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
