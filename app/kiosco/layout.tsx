import type { Metadata, Viewport } from "next";

/** Kiosco de autoservicio: la pantalla táctil del local (components/menu/PublicMenu.tsx en modo kiosco). */
export const metadata: Metadata = {
  title: "Kiosco · B-POS",
  description: "Pide y paga en la pantalla del local.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#f97316", width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return children;
}
