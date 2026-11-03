import type { Metadata } from "next";

/** La App del dueño se instala como app propia: abre en /dueno (no en el POS). */
export const metadata: Metadata = {
  title: "B-POS · App del dueño",
  manifest: "/dueno/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Dueño", statusBarStyle: "black-translucent" },
};

export default function DuenoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
