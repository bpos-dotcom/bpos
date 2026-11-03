/**
 * Las apps instalables de B-POS. Cada una tiene su manifest, su nombre y su
 * identidad (`id`), así que en el celular o la PC son apps distintas y cada
 * una abre en su pantalla:
 *   B-POS (punto de venta)  → /inicio (POS o la primera pantalla permitida)  app/manifest.ts
 *   App del dueño           → /dueno                                         app/dueno/manifest.webmanifest
 *   Cocina (KDS)            → /cocina                                        app/cocina/manifest.webmanifest
 *   Meseros                 → /meseros/<liga>                                app/meseros/[slug]/manifest
 * Chrome ofrece instalar la app de la página donde estás.
 */
export type AppManifestInput = {
  id: string;
  name: string;
  shortName: string;
  description: string;
  startUrl: string;
  orientation?: "portrait" | "landscape" | "any";
};

export const APP_ICONS = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
] as const;

export function appManifest(app: AppManifestInput) {
  return {
    name: app.name,
    short_name: app.shortName,
    description: app.description,
    id: app.id,
    start_url: app.startUrl,
    scope: "/",
    display: "standalone" as const,
    orientation: app.orientation || "any",
    background_color: "#000000",
    theme_color: "#000000",
    lang: "es-MX",
    icons: APP_ICONS.map((i) => ({ ...i })),
  };
}

export function manifestResponse(app: AppManifestInput) {
  return new Response(JSON.stringify(appManifest(app)), {
    headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}

export const OWNER_APP: AppManifestInput = {
  id: "/app-dueno",
  name: "B-POS · App del dueño",
  shortName: "Dueño",
  description: "Ventas, sucursales y alertas de tu negocio en tiempo real.",
  startUrl: "/dueno",
  orientation: "portrait",
};

export const KITCHEN_APP: AppManifestInput = {
  id: "/app-cocina",
  name: "B-POS · Cocina",
  shortName: "Cocina",
  description: "Pantalla de cocina (KDS): los pedidos de cada estación.",
  startUrl: "/cocina",
  orientation: "any",
};

export const POS_APP: AppManifestInput = {
  id: "/app-pos",
  name: "B-POS",
  shortName: "B-POS",
  description: "Punto de venta para restaurantes.",
  startUrl: "/inicio",
  orientation: "any",
};
