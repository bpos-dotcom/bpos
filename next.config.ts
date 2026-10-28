import type { NextConfig } from "next";

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
};

export default nextConfig;
