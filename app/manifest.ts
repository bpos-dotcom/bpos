import type { MetadataRoute } from "next";

// Bloque 12 · B-POS se instala como app en Android, iPhone y computadora.
// Abre en /inicio: el POS para quien vende, la App del dueño para quien no (lib/permissions homePathFor).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "B-POS",
    short_name: "B-POS",
    description: "Ventas, sucursales y alertas de tu negocio en tiempo real.",
    id: "/dueno",
    start_url: "/inicio",
    scope: "/",
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
  };
}
