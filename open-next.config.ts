// Cloudflare (OpenNext): B-POS corre en Cloudflare Workers en lugar de Vercel.
// Sin R2: las páginas que se generan al compilar se sirven desde los archivos estáticos.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});
