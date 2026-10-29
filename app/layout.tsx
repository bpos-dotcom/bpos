import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { CloudGate } from "@/components/cloud/CloudGate";
import { TouchKeyboard } from "@/components/TouchKeyboard";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "B-POS",
  description: "Punto de venta para restaurantes",
  // Instalada en iPhone/iPad abre sin barra de Safari
  appleWebApp: { capable: true, title: "B-POS", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/* Modo claro u oscuro de este dispositivo, antes de pintar */}
        <Script id="bpos-theme" strategy="beforeInteractive">
          {THEME_BOOT_SCRIPT}
        </Script>
        <CloudGate>{children}</CloudGate>
        <TouchKeyboard />
      </body>
    </html>
  );
}
