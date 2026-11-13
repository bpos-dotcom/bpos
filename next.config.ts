import type { NextConfig } from "next";
import { domainRedirects } from "./lib/domain-redirects";

const nextConfig: NextConfig = {
  // Permite abrir B-POS desde el celular o tablet en la misma red WiFi
  // (ej. http://192.168.1.13:3000) mientras corre con INICIAR-BPOS.
  allowedDevOrigins: ["192.168.1.13", "192.168.*.*", "10.*.*.*"],
  // Esta carpeta es la raíz del proyecto (había otro package-lock.json arriba)
  turbopack: {
    root: __dirname,
  },
  // Bloque 13: `next build` deja en .next/standalone un servidor que no
  // necesita node_modules; la app de escritorio (bpos-agent) lo incluye.
  output: "standalone",
  outputFileTracingRoot: __dirname,
  outputFileTracingExcludes: {
    "/*": ["./bpos-agent/**/*", "./_respaldo*/**/*"],
  },
  // La dirección de antes (bpos-alpha.vercel.app) lleva a www.bpos.com.mx.
  // /api se queda igual: el webhook de Mercado Pago aún llega por ahí.
  // La portada vivía en /bpos; ahora es la raíz.
  //
  // Dominios propios de los negocios (sus QR y volantes) → su página en B-POS.
  // Variable DOMAIN_REDIRECTS en Vercel: "midominio.com.mx=/m/mi-liga,otro.mx=/fidelidad/otra"
  // (con o sin www; cualquier ruta del dominio cae ahí).
  async redirects() {
    const oldHost = [{ type: "host" as const, value: "bpos-alpha.vercel.app" }];
    return [
      ...domainRedirects(process.env.DOMAIN_REDIRECTS),
      { source: "/bpos", destination: "/", permanent: false },
      { source: "/", has: oldHost, destination: "https://www.bpos.com.mx/", permanent: false },
      { source: "/:path((?!api/).+)", has: oldHost, destination: "https://www.bpos.com.mx/:path", permanent: false },
    ];
  },
};

export default nextConfig;
