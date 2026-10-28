import type { MetadataRoute } from "next";

// Bloque 12 · B-POS se instala como app en Android, iPhone y computadora.
// Abre directo en la App del dueño; desde ahí se llega al resto de B-POS.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "B-POS · Burger Planet OS",
    short_name: "B-POS",
    description: "Ventas, sucursales y alertas de tu negocio en tiempo real.",
    id: "/dueno",
    start_url: "/dueno",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#000000",
    theme_color: "#000000",
    lang: "es-MX",
    icons: [
      { src: "/app-icon?size=192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icon?size=512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icon?size=512&maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
